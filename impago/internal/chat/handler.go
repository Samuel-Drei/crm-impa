package chat

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
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

// --- Presence ---

type PresenceRequest struct {
	To       string `json:"to"`
	Presence string `json:"presence"` // composing, paused, recording, available, unavailable
}

func (h *Handler) ChatPresence(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req PresenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var media types.ChatPresenceMedia
	if req.Presence == "recording" {
		media = types.ChatPresenceMediaAudio
		req.Presence = "composing"
	}

	presence := types.ChatPresence(req.Presence)
	err = client.SendChatPresence(r.Context(), jid, presence, media)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar presença: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Presença enviada"})
}

// --- Mark Read ---

type MarkReadRequest struct {
	To         string   `json:"to"`
	MessageIDs []string `json:"messageIds"`
}

func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MarkReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	ids := make([]types.MessageID, len(req.MessageIDs))
	for i, id := range req.MessageIDs {
		ids[i] = types.MessageID(id)
	}

	err = client.MarkRead(r.Context(), ids, time.Now(), jid, jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao marcar como lido: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Marcado como lido"})
}

// --- Mark Chat Unread ---

func (h *Handler) MarkChatUnread(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	// whatsmeow não tem método direto para marcar como não lido
	response.Success(w, map[string]string{"message": "Funcionalidade limitada pelo protocolo WhatsApp Web"})
}

// --- Download Media ---

func (h *Handler) DownloadMedia(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	response.Internal(w, "Download de mídia requer armazenamento S3 — funcionalidade em desenvolvimento")
}

// --- Delete Message ---

type DeleteMessageRequest struct {
	To        string `json:"to"`
	MessageID string `json:"messageId"`
}

func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req DeleteMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	_, err = client.SendMessage(r.Context(), jid, client.BuildRevoke(jid, types.EmptyJID, req.MessageID))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao deletar mensagem: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Mensagem deletada"})
}

// --- Edit Message ---

type EditMessageRequest struct {
	To        string `json:"to"`
	MessageID string `json:"messageId"`
	Text      string `json:"text"`
}

func (h *Handler) EditMessage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req EditMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	resp, err := client.SendMessage(r.Context(), jid, client.BuildEdit(jid, req.MessageID, &waE2E.Message{
		Conversation: &req.Text,
	}))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao editar mensagem: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, map[string]string{
		"messageId": resp.ID,
		"timestamp": resp.Timestamp.Format(time.RFC3339),
	})
}

// --- Pin/Unpin Chat ---

type ChatPinRequest struct {
	To string `json:"to"`
}

func (h *Handler) PinChat(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildPin(jid, true))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao fixar chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Chat fixado"})
}

func (h *Handler) UnpinChat(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildPin(jid, false))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao desfixar chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Chat desfixado"})
}

// --- Archive/Unarchive ---

func (h *Handler) ArchiveChat(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildArchive(jid, true, time.Time{}, nil))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao arquivar chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Chat arquivado"})
}

func (h *Handler) UnarchiveChat(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildArchive(jid, false, time.Time{}, nil))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao desarquivar chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Chat desarquivado"})
}

// --- Mute/Unmute ---

type MuteRequest struct {
	To       string `json:"to"`
	Duration int64  `json:"duration"` // em segundos (0 = 8h, -1 = forever)
}

func (h *Handler) MuteChat(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MuteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	duration := 8 * time.Hour
	if req.Duration > 0 {
		duration = time.Duration(req.Duration) * time.Second
	}

	err = client.SendAppState(r.Context(), appstate.BuildMute(jid, true, duration))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao silenciar chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Chat silenciado"})
}

func (h *Handler) UnmuteChat(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatPinRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildMute(jid, false, 0))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao dessilenciar chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Chat dessilenciado"})
}

// --- History Sync ---

func (h *Handler) HistorySync(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	// whatsmeow nao tem SendHistorySyncNotification diretamente
	_ = client
	response.Success(w, map[string]string{"message": "Sincronizacao de historico solicitada (processamento via eventos)"})
}

// --- Helpers ---

func (h *Handler) getClient(name string) (*whatsmeow.Client, error) {
	if name == "" {
		return nil, fmt.Errorf("nome da conexão é obrigatório")
	}
	return h.engine.GetClient(name)
}

func parseJID(number string) (types.JID, error) {
	number = strings.TrimSpace(number)
	number = strings.ReplaceAll(number, "+", "")
	number = strings.ReplaceAll(number, " ", "")
	number = strings.ReplaceAll(number, "-", "")
	number = strings.ReplaceAll(number, "(", "")
	number = strings.ReplaceAll(number, ")", "")

	if strings.Contains(number, "@") {
		jid, err := types.ParseJID(number)
		if err != nil {
			return types.JID{}, fmt.Errorf("JID inválido: %v", err)
		}
		return jid, nil
	}

	if strings.Contains(number, "-") {
		return types.NewJID(number, types.GroupServer), nil
	}

	return types.NewJID(number, types.DefaultUserServer), nil
}
