package newsletter

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"

	"impago/internal/engine"
	"impago/internal/response"
)

type Handler struct {
	engine *engine.Manager
}

func NewHandler(eng *engine.Manager) *Handler {
	return &Handler{engine: eng}
}

// --- Create Newsletter ---

type CreateNewsletterRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	PictureURL  string `json:"pictureUrl"`
}

func (h *Handler) CreateNewsletter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req CreateNewsletterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.Name == "" {
		response.BadRequest(w, "Nome do newsletter e obrigatorio")
		return
	}

	createReq := whatsmeow.CreateNewsletterParams{
		Name:        req.Name,
		Description: req.Description,
	}

	if req.PictureURL != "" {
		imgData, err := downloadURL(req.PictureURL)
		if err == nil {
			createReq.Picture = imgData
		}
	}

	meta, err := client.CreateNewsletter(r.Context(), createReq)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao criar newsletter: %v", err))
		return
	}

	response.Success(w, meta)
}

// --- List Subscribed Newsletters ---

func (h *Handler) ListNewsletters(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	newsletters, err := client.GetSubscribedNewsletters(r.Context())
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao listar newsletters: %v", err))
		return
	}

	response.Success(w, newsletters)
}

// --- Get Newsletter Info ---

type GetNewsletterRequest struct {
	NewsletterJID string `json:"newsletterJid"`
}

func (h *Handler) GetNewsletter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GetNewsletterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseNewsletterJID(req.NewsletterJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	info, err := client.GetNewsletterInfo(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter info do newsletter: %v", err))
		return
	}

	response.Success(w, info)
}

// --- Get Newsletter Info by Invite Link ---

type GetNewsletterInviteRequest struct {
	InviteLink string `json:"inviteLink"`
}

func (h *Handler) GetNewsletterByInvite(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GetNewsletterInviteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	key := req.InviteLink
	if strings.Contains(key, "/") {
		parts := strings.Split(key, "/")
		key = parts[len(parts)-1]
	}

	info, err := client.GetNewsletterInfoWithInvite(r.Context(), key)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter newsletter por invite: %v", err))
		return
	}

	response.Success(w, info)
}

// --- Follow Newsletter ---

type FollowNewsletterRequest struct {
	NewsletterJID string `json:"newsletterJid"`
}

func (h *Handler) FollowNewsletter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req FollowNewsletterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseNewsletterJID(req.NewsletterJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.FollowNewsletter(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao seguir newsletter: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Newsletter seguido com sucesso"})
}

// --- Unfollow Newsletter ---

func (h *Handler) UnfollowNewsletter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req FollowNewsletterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseNewsletterJID(req.NewsletterJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.UnfollowNewsletter(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao deixar de seguir newsletter: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Deixou de seguir newsletter"})
}

// --- Mute/Unmute Newsletter ---

type MuteNewsletterRequest struct {
	NewsletterJID string `json:"newsletterJid"`
}

func (h *Handler) MuteNewsletter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MuteNewsletterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseNewsletterJID(req.NewsletterJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.NewsletterToggleMute(r.Context(), jid, true)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao mutar newsletter: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Newsletter mutado"})
}

func (h *Handler) UnmuteNewsletter(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MuteNewsletterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseNewsletterJID(req.NewsletterJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.NewsletterToggleMute(r.Context(), jid, false)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao desmutar newsletter: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Newsletter desmutado"})
}

// --- Get Newsletter Messages ---

type GetMessagesRequest struct {
	NewsletterJID string `json:"newsletterJid"`
	Count         int    `json:"count"`
	Before        int    `json:"before"`
}

func (h *Handler) GetNewsletterMessages(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GetMessagesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseNewsletterJID(req.NewsletterJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	count := req.Count
	if count <= 0 {
		count = 50
	}

	params := &whatsmeow.GetNewsletterMessagesParams{
		Count: count,
	}
	if req.Before > 0 {
		params.Before = req.Before
	}

	messages, err := client.GetNewsletterMessages(r.Context(), jid, params)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter mensagens: %v", err))
		return
	}

	response.Success(w, messages)
}

// --- Send Newsletter Admin Invite ---

type AdminInviteRequest struct {
	NewsletterJID string `json:"newsletterJid"`
	Number        string `json:"number"`
}

func (h *Handler) SendAdminInvite(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	// whatsmeow nao tem metodo NewsletterSendAdminInvite
	response.Error(w, http.StatusNotImplemented, "Envio de convite de admin de newsletter nao suportado pela API atual")
}

// --- Helpers ---

func (h *Handler) getClient(name string) (*whatsmeow.Client, error) {
	if name == "" {
		return nil, fmt.Errorf("nome da conexao e obrigatorio")
	}
	return h.engine.GetClient(name)
}

func parseNewsletterJID(s string) (types.JID, error) {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "@") {
		jid, err := types.ParseJID(s)
		if err != nil {
			return types.JID{}, fmt.Errorf("JID de newsletter invalido: %v", err)
		}
		return jid, nil
	}
	return types.NewJID(s, types.NewsletterServer), nil
}

func downloadURL(rawURL string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download retornou status %d", resp.StatusCode)
	}

	const maxSize = 10 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSize))
	if err != nil {
		return nil, fmt.Errorf("falha ao ler dados: %v", err)
	}
	return data, nil
}
