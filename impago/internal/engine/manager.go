package engine

import (
	"context"
	"fmt"
	"sync"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"

	_ "github.com/lib/pq"

	"impago/internal/config"
)

type Callbacks interface {
	OnConnected(name string, jid string) error
	OnDisconnected(name string, reason string) error
	OnQRCode(name string, qrBase64 string, code string) error
	OnPaired(name string, jid string) error
	OnLoggedOut(name string, reason string) error
}

type SessionStatus struct {
	Connected bool   `json:"connected"`
	LoggedIn  bool   `json:"loggedIn"`
	JID       string `json:"jid,omitempty"`
	Name      string `json:"name,omitempty"`
	PushName  string `json:"pushName,omitempty"`
}

type QRData struct {
	QRCode string `json:"qrcode"`
	Code   string `json:"code"`
}

type SessionConfig struct {
	Name         string
	JID          string
	WebhookURL   string
	Events       []string
	AlwaysOnline bool
	RejectCalls  bool
	ReadMessages bool
	IgnoreGroups bool
	IgnoreStatus bool
	ProxyHost    string
	ProxyPort    string
	ProxyUser    string
	ProxyPass    string
}

type Manager struct {
	mu          sync.RWMutex
	sessions    map[string]*Session
	container   *sqlstore.Container
	config      *config.Config
	callbacks   Callbacks
	dispatcher  EventDispatcher
	log         zerolog.Logger
}

type EventDispatcher interface {
	Dispatch(event Event)
}

type Event struct {
	Type       string      `json:"event"`
	Timestamp  string      `json:"timestamp"`
	Connection EventConn   `json:"connection"`
	Data       interface{} `json:"data"`
}

type EventConn struct {
	Name string `json:"name"`
	JID  string `json:"jid,omitempty"`
}

func NewManager(cfg *config.Config, dispatcher EventDispatcher) (*Manager, error) {
	container, err := sqlstore.New(context.Background(), "postgres", cfg.DatabaseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("falha ao inicializar store de sessões: %w", err)
	}

	log.Info().Msg("Store de sessões WhatsApp inicializado")

	return &Manager{
		sessions:   make(map[string]*Session),
		container:  container,
		config:     cfg,
		dispatcher: dispatcher,
		log:        log.With().Str("module", "engine").Logger(),
	}, nil
}

func (m *Manager) SetCallbacks(cb Callbacks) {
	m.callbacks = cb
}

func (m *Manager) StartSession(sc SessionConfig) error {
	m.mu.Lock()
	if existing, ok := m.sessions[sc.Name]; ok {
		if existing.client != nil && existing.client.IsConnected() {
			m.mu.Unlock()
			return fmt.Errorf("sessão '%s' já está conectada", sc.Name)
		}
		existing.Stop()
		delete(m.sessions, sc.Name)
	}
	m.mu.Unlock()

	session, err := newSession(m, sc)
	if err != nil {
		return fmt.Errorf("falha ao criar sessão '%s': %w", sc.Name, err)
	}

	m.mu.Lock()
	m.sessions[sc.Name] = session
	m.mu.Unlock()

	go session.Run()

	m.log.Info().Str("connection", sc.Name).Msg("Sessão iniciada")
	return nil
}

func (m *Manager) StopSession(name string) error {
	m.mu.Lock()
	session, ok := m.sessions[name]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("sessão '%s' não encontrada", name)
	}
	m.mu.Unlock()

	session.Stop()

	m.mu.Lock()
	delete(m.sessions, name)
	m.mu.Unlock()

	m.log.Info().Str("connection", name).Msg("Sessão parada")
	return nil
}

func (m *Manager) RestartSession(name string) error {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("sessão '%s' não encontrada", name)
	}

	sc := session.sessionConfig

	if err := m.StopSession(name); err != nil {
		return err
	}

	return m.StartSession(sc)
}

func (m *Manager) LogoutSession(name string) error {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("sessão '%s' não encontrada", name)
	}

	if session.client != nil && session.client.IsLoggedIn() {
		if err := session.client.Logout(context.Background()); err != nil {
			m.log.Warn().Err(err).Str("connection", name).Msg("Erro no logout")
		}
	}

	session.Stop()

	m.mu.Lock()
	delete(m.sessions, name)
	m.mu.Unlock()

	m.log.Info().Str("connection", name).Msg("Logout realizado")
	return nil
}

func (m *Manager) GetStatus(name string) (*SessionStatus, error) {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return &SessionStatus{Connected: false}, nil
	}

	status := &SessionStatus{
		Connected: session.client != nil && session.client.IsConnected(),
		LoggedIn:  session.client != nil && session.client.IsLoggedIn(),
		Name:      name,
	}

	if session.client != nil && session.client.Store != nil && session.client.Store.ID != nil {
		status.JID = session.client.Store.ID.String()
		status.PushName = session.client.Store.PushName
	}

	return status, nil
}

func (m *Manager) GetQRCode(name string) (*QRData, error) {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("sessão '%s' não encontrada. Inicie a sessão primeiro", name)
	}

	if session.client != nil && session.client.IsLoggedIn() {
		return nil, fmt.Errorf("sessão '%s' já está autenticada", name)
	}

	session.mu.RLock()
	qr := session.currentQR
	code := session.currentCode
	session.mu.RUnlock()

	if qr == "" {
		return nil, fmt.Errorf("QR code ainda não disponível para '%s'. Aguarde alguns segundos", name)
	}

	return &QRData{QRCode: qr, Code: code}, nil
}

func (m *Manager) PairPhone(name, phone string) (string, error) {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("sessão '%s' não encontrada", name)
	}

	if session.client == nil {
		return "", fmt.Errorf("cliente WhatsApp não inicializado para '%s'", name)
	}

	code, err := session.client.PairPhone(context.Background(), phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return "", fmt.Errorf("falha no pareamento: %w", err)
	}

	return code, nil
}

func (m *Manager) GetClient(name string) (*whatsmeow.Client, error) {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("sessão '%s' não encontrada", name)
	}

	if session.client == nil || !session.client.IsConnected() {
		return nil, fmt.Errorf("sessão '%s' não está conectada", name)
	}

	return session.client, nil
}

func (m *Manager) IsConnected(name string) bool {
	m.mu.RLock()
	session, ok := m.sessions[name]
	m.mu.RUnlock()

	if !ok {
		return false
	}

	return session.client != nil && session.client.IsConnected()
}

func (m *Manager) ConnectOnStartup(configs []SessionConfig) {
	for _, sc := range configs {
		if err := m.StartSession(sc); err != nil {
			m.log.Error().Err(err).Str("connection", sc.Name).Msg("Falha ao reconectar na inicialização")
		}
	}
}
