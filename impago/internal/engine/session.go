package engine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"

	waCompanionReg "go.mau.fi/whatsmeow/proto/waCompanionReg"
	"google.golang.org/protobuf/proto"
)

type Session struct {
	client        *whatsmeow.Client
	sessionConfig SessionConfig
	manager       *Manager
	cancel        context.CancelFunc
	ctx           context.Context
	log           zerolog.Logger

	mu          sync.RWMutex
	currentQR   string
	currentCode string
}

// fetchWhatsAppWebVersion busca a versão atual do WhatsApp Web para evitar detecção por versão obsoleta
func fetchWhatsAppWebVersion() (major, minor, patch int, err error) {
	resp, err := http.Get("https://web.whatsapp.com/check-update?version=0&platform=web")
	if err != nil {
		return 0, 0, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, 0, 0, err
	}

	var result struct {
		CurrentVersion string `json:"currentVersion"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, 0, 0, err
	}

	if result.CurrentVersion != "" {
		var maj, min, pat int
		n, _ := fmt.Sscanf(result.CurrentVersion, "%d.%d.%d", &maj, &min, &pat)
		if n >= 2 {
			return maj, min, pat, nil
		}
	}

	return 0, 0, 0, fmt.Errorf("versão não encontrada na resposta")
}

func newSession(mgr *Manager, sc SessionConfig) (*Session, error) {
	// Anti-ban: configurar OS name (igual EvoGo)
	osName := mgr.config.WAOsName
	if osName == "" {
		osName = "Chrome"
	}
	store.DeviceProps.Os = proto.String(osName)
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()

	// Anti-ban: RequireFullSync - aparenta ser um device legítimo novo
	store.DeviceProps.RequireFullSync = proto.Bool(true)

	// Anti-ban: configurar versão do WhatsApp Web
	cfg := mgr.config
	major, minor, patch := cfg.WAVersionMajor, cfg.WAVersionMinor, cfg.WAVersionPatch

	// Se versão não foi configurada manualmente, tenta buscar a versão atual do WA Web
	if major == 2 && minor == 3000 && patch == 0 {
		if webMaj, webMin, webPat, err := fetchWhatsAppWebVersion(); err == nil && webMaj > 0 {
			major, minor, patch = webMaj, webMin, webPat
			mgr.log.Info().Msgf("Versão do WhatsApp Web detectada: %d.%d.%d", major, minor, patch)
		}
	}

	if major > 0 {
		store.DeviceProps.Version = &waCompanionReg.DeviceProps_AppVersion{
			Primary:   proto.Uint32(uint32(major)),
			Secondary: proto.Uint32(uint32(minor)),
			Tertiary:  proto.Uint32(uint32(patch)),
		}
	}

	var device *store.Device
	var err error

	if sc.JID != "" {
		devices, findErr := mgr.container.GetAllDevices(context.Background())
		if findErr == nil {
			for _, d := range devices {
				if d.ID != nil && d.ID.String() == sc.JID {
					device = d
					break
				}
			}
		}
	}

	if device == nil {
		device = mgr.container.NewDevice()
	}

	client := whatsmeow.NewClient(device, nil)

	// Anti-ban: flags críticas do whatsmeow (igual EvoGo)
	client.SendReportingTokens = true  // Envia device tokens — aparenta cliente legítimo
	client.AutoTrustIdentity = true    // Auto-confia em chaves de identidade
	client.EnableAutoReconnect = false // Reconexão manual — evita padrão suspeito

	ctx, cancel := context.WithCancel(context.Background())

	s := &Session{
		client:        client,
		sessionConfig: sc,
		manager:       mgr,
		ctx:           ctx,
		cancel:        cancel,
		log:           mgr.log.With().Str("connection", sc.Name).Logger(),
	}

	client.AddEventHandler(s.handleEvent)

	return s, err
}

func (s *Session) Run() {
	if s.client.Store.ID != nil {
		s.log.Info().Msg("Reconectando sessão existente")
		err := s.client.Connect()
		if err != nil {
			s.log.Error().Err(err).Msg("Falha na reconexão")
			s.notifyDisconnected(fmt.Sprintf("falha na reconexão: %v", err))
		}
		return
	}

	s.log.Info().Msg("Nova sessão — aguardando QR code")
	qrChan, _ := s.client.GetQRChannel(s.ctx)
	err := s.client.Connect()
	if err != nil {
		s.log.Error().Err(err).Msg("Falha ao conectar para QR")
		return
	}

	go s.processQRChannel(qrChan)
}

func (s *Session) processQRChannel(qrChan <-chan whatsmeow.QRChannelItem) {
	for {
		select {
		case <-s.ctx.Done():
			return
		case evt, ok := <-qrChan:
			if !ok {
				return
			}
			switch evt.Event {
			case "code":
				s.log.Info().Msg("QR code gerado")
				qrBase64, err := generateQRBase64(evt.Code)
				if err != nil {
					s.log.Error().Err(err).Msg("Falha ao gerar imagem QR")
					continue
				}

				s.mu.Lock()
				s.currentQR = qrBase64
				s.currentCode = evt.Code
				s.mu.Unlock()

				if s.manager.callbacks != nil {
					if cbErr := s.manager.callbacks.OnQRCode(s.sessionConfig.Name, qrBase64, evt.Code); cbErr != nil {
						s.log.Warn().Err(cbErr).Msg("Falha no callback OnQRCode")
					}
				}

				s.dispatchEvent("qrcode.updated", map[string]string{
					"qrcode": qrBase64,
					"code":   evt.Code,
				})

			case "timeout":
				s.log.Warn().Msg("Timeout do QR code")
				s.mu.Lock()
				s.currentQR = ""
				s.currentCode = ""
				s.mu.Unlock()

			case "success":
				s.log.Info().Msg("Pareamento via QR code bem-sucedido")
				s.mu.Lock()
				s.currentQR = ""
				s.currentCode = ""
				s.mu.Unlock()
			}
		}
	}
}

func (s *Session) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	if s.client != nil && s.client.IsConnected() {
		s.client.Disconnect()
	}
}

func (s *Session) notifyDisconnected(reason string) {
	if s.manager.callbacks != nil {
		if err := s.manager.callbacks.OnDisconnected(s.sessionConfig.Name, reason); err != nil {
			s.log.Warn().Err(err).Msg("Falha no callback OnDisconnected")
		}
	}
}

func (s *Session) dispatchEvent(eventType string, data interface{}) {
	if s.manager.dispatcher == nil {
		return
	}

	jid := ""
	if s.client != nil && s.client.Store != nil && s.client.Store.ID != nil {
		jid = s.client.Store.ID.String()
	}

	s.manager.dispatcher.Dispatch(Event{
		Type:      eventType,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Connection: EventConn{
			Name: s.sessionConfig.Name,
			JID:  jid,
		},
		Data: data,
	})
}

func generateQRBase64(code string) (string, error) {
	png, err := qrcode.Encode(code, qrcode.Medium, 512)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}
