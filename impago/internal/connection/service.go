package connection

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"github.com/rs/zerolog/log"

	"impago/internal/engine"
)

var namePattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$`)

type Service struct {
	repo    *Repository
	engine  *engine.Manager
}

func NewService(repo *Repository, eng *engine.Manager) *Service {
	svc := &Service{
		repo:   repo,
		engine: eng,
	}
	eng.SetCallbacks(svc)
	return svc
}

type CreateInput struct {
	Name         string `json:"name"`
	WebhookURL   string `json:"webhookUrl,omitempty"`
	Events       string `json:"events,omitempty"`
	AlwaysOnline bool   `json:"alwaysOnline,omitempty"`
	RejectCalls  bool   `json:"rejectCalls,omitempty"`
	ReadMessages bool   `json:"readMessages,omitempty"`
	IgnoreGroups bool   `json:"ignoreGroups,omitempty"`
	IgnoreStatus bool   `json:"ignoreStatus,omitempty"`
}

type CreateResult struct {
	Connection ConnectionPublic `json:"connection"`
	Token      string           `json:"token"`
}

type UpdateInput struct {
	WebhookURL   *string `json:"webhookUrl,omitempty"`
	Events       *string `json:"events,omitempty"`
	AlwaysOnline *bool   `json:"alwaysOnline,omitempty"`
	RejectCalls  *bool   `json:"rejectCalls,omitempty"`
	ReadMessages *bool   `json:"readMessages,omitempty"`
	IgnoreGroups *bool   `json:"ignoreGroups,omitempty"`
	IgnoreStatus *bool   `json:"ignoreStatus,omitempty"`
}

func (s *Service) Create(input CreateInput) (*CreateResult, error) {
	input.Name = strings.TrimSpace(strings.ToLower(input.Name))

	if !namePattern.MatchString(input.Name) {
		return nil, fmt.Errorf("nome inválido: use apenas letras minúsculas, números e hífens (2-100 caracteres)")
	}

	exists, err := s.repo.NameExists(input.Name)
	if err != nil {
		return nil, fmt.Errorf("erro ao verificar nome: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("já existe uma conexão com o nome '%s'", input.Name)
	}

	rawToken, tokenHash, tokenHint := generateToken()

	conn := &Connection{
		Name:         input.Name,
		TokenHash:    tokenHash,
		TokenHint:    tokenHint,
		WebhookURL:   input.WebhookURL,
		Events:       input.Events,
		AlwaysOnline: input.AlwaysOnline,
		RejectCalls:  input.RejectCalls,
		ReadMessages: input.ReadMessages,
		IgnoreGroups: input.IgnoreGroups,
		IgnoreStatus: input.IgnoreStatus,
	}

	if err := s.repo.Create(conn); err != nil {
		return nil, fmt.Errorf("falha ao criar conexão: %w", err)
	}

	log.Info().Str("name", conn.Name).Msg("Conexão criada")

	return &CreateResult{
		Connection: conn.ToPublic(),
		Token:      rawToken,
	}, nil
}

func (s *Service) GetByName(name string) (*ConnectionPublic, error) {
	conn, err := s.repo.GetByName(name)
	if err != nil {
		return nil, err
	}
	pub := conn.ToPublic()
	return &pub, nil
}

func (s *Service) GetAll(page, limit int) ([]ConnectionPublic, int64, error) {
	conns, total, err := s.repo.GetAll(page, limit)
	if err != nil {
		return nil, 0, err
	}

	result := make([]ConnectionPublic, len(conns))
	for i, c := range conns {
		result[i] = c.ToPublic()
	}
	return result, total, nil
}

func (s *Service) Update(name string, input UpdateInput) (*ConnectionPublic, error) {
	conn, err := s.repo.GetByName(name)
	if err != nil {
		return nil, err
	}

	if input.WebhookURL != nil {
		conn.WebhookURL = *input.WebhookURL
	}
	if input.Events != nil {
		conn.Events = *input.Events
	}
	if input.AlwaysOnline != nil {
		conn.AlwaysOnline = *input.AlwaysOnline
	}
	if input.RejectCalls != nil {
		conn.RejectCalls = *input.RejectCalls
	}
	if input.ReadMessages != nil {
		conn.ReadMessages = *input.ReadMessages
	}
	if input.IgnoreGroups != nil {
		conn.IgnoreGroups = *input.IgnoreGroups
	}
	if input.IgnoreStatus != nil {
		conn.IgnoreStatus = *input.IgnoreStatus
	}

	if err := s.repo.Update(conn); err != nil {
		return nil, fmt.Errorf("falha ao atualizar conexão: %w", err)
	}

	pub := conn.ToPublic()
	return &pub, nil
}

func (s *Service) Delete(name string) error {
	if s.engine.IsConnected(name) {
		if err := s.engine.LogoutSession(name); err != nil {
			log.Warn().Err(err).Str("name", name).Msg("Erro ao desconectar sessão antes de deletar")
		}
	}

	if err := s.repo.Delete(name); err != nil {
		return fmt.Errorf("falha ao deletar conexão: %w", err)
	}

	log.Info().Str("name", name).Msg("Conexão deletada")
	return nil
}

func (s *Service) StartSession(name string) error {
	conn, err := s.repo.GetByName(name)
	if err != nil {
		return err
	}

	sc := engine.SessionConfig{
		Name:         conn.Name,
		JID:          conn.JID,
		WebhookURL:   conn.WebhookURL,
		AlwaysOnline: conn.AlwaysOnline,
		RejectCalls:  conn.RejectCalls,
		ReadMessages: conn.ReadMessages,
		IgnoreGroups: conn.IgnoreGroups,
		IgnoreStatus: conn.IgnoreStatus,
	}

	if conn.Events != "" {
		sc.Events = strings.Split(conn.Events, ",")
	}

	return s.engine.StartSession(sc)
}

func (s *Service) StopSession(name string) error {
	return s.engine.StopSession(name)
}

func (s *Service) RestartSession(name string) error {
	return s.engine.RestartSession(name)
}

func (s *Service) LogoutSession(name string) error {
	return s.engine.LogoutSession(name)
}

func (s *Service) GetStatus(name string) (*engine.SessionStatus, error) {
	return s.engine.GetStatus(name)
}

func (s *Service) GetQRCode(name string) (*engine.QRData, error) {
	return s.engine.GetQRCode(name)
}

func (s *Service) PairPhone(name, phone string) (string, error) {
	return s.engine.PairPhone(name, phone)
}

func (s *Service) Authenticate(token string) (*Connection, error) {
	hash := hashToken(token)
	conn, err := s.repo.GetByTokenHash(hash)
	if err != nil {
		return nil, fmt.Errorf("token inválido")
	}
	return conn, nil
}

func (s *Service) ReconnectAll() {
	conns, err := s.repo.GetAllConnected()
	if err != nil {
		log.Error().Err(err).Msg("Falha ao buscar conexões para reconexão")
		return
	}

	configs := make([]engine.SessionConfig, 0, len(conns))
	for _, conn := range conns {
		sc := engine.SessionConfig{
			Name:         conn.Name,
			JID:          conn.JID,
			WebhookURL:   conn.WebhookURL,
			AlwaysOnline: conn.AlwaysOnline,
			RejectCalls:  conn.RejectCalls,
			ReadMessages: conn.ReadMessages,
			IgnoreGroups: conn.IgnoreGroups,
			IgnoreStatus: conn.IgnoreStatus,
		}
		if conn.Events != "" {
			sc.Events = strings.Split(conn.Events, ",")
		}
		configs = append(configs, sc)
	}

	s.engine.ConnectOnStartup(configs)
}

// --- Callbacks (implementa engine.Callbacks) ---

func (s *Service) OnConnected(name string, jid string) error {
	if err := s.repo.UpdateJID(name, jid); err != nil {
		return err
	}
	return s.repo.UpdateStatus(name, true, "connected")
}

func (s *Service) OnDisconnected(name string, reason string) error {
	return s.repo.UpdateStatus(name, false, reason)
}

func (s *Service) OnQRCode(name string, qrBase64 string, code string) error {
	return s.repo.UpdateQRCode(name, qrBase64)
}

func (s *Service) OnPaired(name string, jid string) error {
	if err := s.repo.UpdateJID(name, jid); err != nil {
		return err
	}
	if err := s.repo.ClearQRCode(name); err != nil {
		return err
	}
	return s.repo.UpdateStatus(name, true, "paired")
}

func (s *Service) OnLoggedOut(name string, reason string) error {
	if err := s.repo.ClearQRCode(name); err != nil {
		return err
	}
	return s.repo.UpdateStatus(name, false, reason)
}

// --- Utilitários de token ---

func generateToken() (raw string, hash string, hint string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("falha ao gerar bytes aleatórios: " + err.Error())
	}

	raw = "impa_" + hex.EncodeToString(b)
	hash = hashToken(raw)
	hint = "..." + raw[len(raw)-8:]
	return
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
