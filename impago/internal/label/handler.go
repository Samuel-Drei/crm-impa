package label

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
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

// --- List Labels ---

func (h *Handler) GetLabels(w http.ResponseWriter, r *http.Request) {
	// whatsmeow não tem GetLabels() - labels estão armazenadas no app state local
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"message": "Labels são gerenciadas localmente pelo WhatsApp. Use o app para listar.",
		"labels":  []interface{}{},
	})
}

// --- Get Label ---

func (h *Handler) GetLabelByID(w http.ResponseWriter, r *http.Request) {
	labelID := chi.URLParam(r, "labelId")
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"labelId": labelID,
		"message": "Dados de label individual não disponíveis via API",
	})
}

// --- Get Labeled Chats ---

func (h *Handler) GetLabeledChats(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "labelId")
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"message": "Chats associados a labels não disponíveis via API",
		"chats":   []interface{}{},
	})
}

// --- Create/Edit Label ---

type EditLabelRequest struct {
	LabelID int32  `json:"labelId"`
	Name    string `json:"name"`
	Color   int32  `json:"color"`
}

func (h *Handler) CreateLabel(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req EditLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildLabelEdit(fmt.Sprintf("%d", req.LabelID), req.Name, req.Color, false))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao criar label: %v", err))
		return
	}

	response.Success(w, map[string]interface{}{
		"message": "Label criada",
		"labelId": req.LabelID,
		"name":    req.Name,
		"color":   req.Color,
	})
}

func (h *Handler) EditLabel(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req EditLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildLabelEdit(fmt.Sprintf("%d", req.LabelID), req.Name, req.Color, false))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao editar label: %v", err))
		return
	}

	response.Success(w, map[string]interface{}{
		"message": "Label editada",
		"labelId": req.LabelID,
	})
}

// --- Chat Labels ---

type ChatLabelRequest struct {
	To      string `json:"to"`
	LabelID string `json:"labelId"`
}

func (h *Handler) ChatLabel(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildLabelChat(jid, req.LabelID, true))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir label do chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Label associada ao chat"})
}

func (h *Handler) ChatUnlabel(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ChatLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildLabelChat(jid, req.LabelID, false))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao remover label do chat: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Label removida do chat"})
}

// --- Message Labels ---

type MessageLabelRequest struct {
	To        string `json:"to"`
	LabelID   string `json:"labelId"`
	MessageID string `json:"messageId"`
}

func (h *Handler) MessageLabel(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MessageLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildLabelMessage(jid, req.LabelID, req.MessageID, true))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir label na mensagem: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Label associada à mensagem"})
}

func (h *Handler) MessageUnlabel(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MessageLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SendAppState(r.Context(), appstate.BuildLabelMessage(jid, req.LabelID, req.MessageID, false))
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao remover label da mensagem: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Label removida da mensagem"})
}

// --- Label Associations ---

func (h *Handler) GetLabelAssociations(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"message":      "Associações de labels não disponíveis via API",
		"associations": []interface{}{},
	})
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
