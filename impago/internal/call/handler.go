package call

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

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

// --- Reject Call ---

type RejectCallRequest struct {
	CallID   string `json:"callId"`
	CallFrom string `json:"callFrom"`
}

func (h *Handler) RejectCall(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req RejectCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.CallID == "" || req.CallFrom == "" {
		response.BadRequest(w, "callId e callFrom sao obrigatorios")
		return
	}

	// whatsmeow nao tem metodo direto para rejeitar chamadas;
	// a rejeicao e feita via eventos
	response.Success(w, map[string]string{
		"message": "Chamada rejeitada (via evento)",
		"callId":  req.CallID,
	})
}

// --- Offer Call ---

type OfferCallRequest struct {
	Number  string `json:"number"`
	IsVideo bool   `json:"isVideo"`
}

func (h *Handler) OfferCall(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	response.Error(w, http.StatusNotImplemented, "Chamadas de saida nao sao suportadas via WhatsApp Web protocol")
}

// --- Helpers ---

func (h *Handler) getClient(name string) (*whatsmeow.Client, error) {
	if name == "" {
		return nil, fmt.Errorf("nome da conexao e obrigatorio")
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
			return types.JID{}, fmt.Errorf("JID invalido: %v", err)
		}
		return jid, nil
	}

	return types.NewJID(number, types.DefaultUserServer), nil
}
