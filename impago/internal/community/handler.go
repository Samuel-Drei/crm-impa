package community

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

// --- Create Community ---

type CreateCommunityRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	GroupJIDs   []string `json:"groupJids"`
}

func (h *Handler) CreateCommunity(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req CreateCommunityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.Name == "" {
		response.BadRequest(w, "Nome da comunidade e obrigatorio")
		return
	}

	linkedGroups := make([]types.JID, 0, len(req.GroupJIDs))
	for _, g := range req.GroupJIDs {
		jid, err := parseGroupJID(g)
		if err != nil {
			continue
		}
		linkedGroups = append(linkedGroups, jid)
	}

	createReq := whatsmeow.ReqCreateGroup{
		Name:         req.Name,
		Participants: []types.JID{},
		CreateKey:    whatsmeow.GenerateMessageID(),
		GroupParent: types.GroupParent{
			IsParent: true,
		},
	}

	info, err := client.CreateGroup(r.Context(), createReq)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao criar comunidade: %v", err))
		return
	}

	for _, gJID := range linkedGroups {
		_ = client.LinkGroup(r.Context(), info.JID, gJID)
	}

	if req.Description != "" {
		_ = client.SetGroupTopic(r.Context(), info.JID, "", "", req.Description)
	}

	response.Success(w, map[string]interface{}{
		"communityJid": info.JID.String(),
		"name":         info.Name,
		"message":      "Comunidade criada",
	})
}

// --- Add Group to Community ---

type CommunityGroupRequest struct {
	CommunityJID string   `json:"communityJid"`
	GroupJIDs    []string `json:"groupJids"`
}

func (h *Handler) CommunityAddGroup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req CommunityGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	communityJID, err := parseGroupJID(req.CommunityJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	results := make([]map[string]interface{}, 0)
	for _, g := range req.GroupJIDs {
		gJID, err := parseGroupJID(g)
		if err != nil {
			results = append(results, map[string]interface{}{
				"groupJid": g,
				"success":  false,
				"error":    err.Error(),
			})
			continue
		}

		err = client.LinkGroup(r.Context(), communityJID, gJID)
		if err != nil {
			results = append(results, map[string]interface{}{
				"groupJid": g,
				"success":  false,
				"error":    err.Error(),
			})
		} else {
			results = append(results, map[string]interface{}{
				"groupJid": g,
				"success":  true,
			})
		}
	}

	response.Success(w, results)
}

// --- Remove Group from Community ---

func (h *Handler) CommunityRemoveGroup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req CommunityGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	communityJID, err := parseGroupJID(req.CommunityJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	results := make([]map[string]interface{}, 0)
	for _, g := range req.GroupJIDs {
		gJID, err := parseGroupJID(g)
		if err != nil {
			results = append(results, map[string]interface{}{
				"groupJid": g,
				"success":  false,
				"error":    err.Error(),
			})
			continue
		}

		err = client.UnlinkGroup(r.Context(), communityJID, gJID)
		if err != nil {
			results = append(results, map[string]interface{}{
				"groupJid": g,
				"success":  false,
				"error":    err.Error(),
			})
		} else {
			results = append(results, map[string]interface{}{
				"groupJid": g,
				"success":  true,
			})
		}
	}

	response.Success(w, results)
}

// --- Deactivate Community ---

func (h *Handler) DeactivateCommunity(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req struct {
		CommunityJID string `json:"communityJid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	communityJID, err := parseGroupJID(req.CommunityJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.LeaveGroup(r.Context(), communityJID)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao desativar comunidade: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Comunidade desativada"})
}

// --- Get Community Info ---

func (h *Handler) GetCommunityInfo(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	communityJID := chi.URLParam(r, "communityJid")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	jid, err := parseGroupJID(communityJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	info, err := client.GetGroupInfo(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter info da comunidade: %v", err))
		return
	}

	linkedGroups := make([]map[string]string, 0)
	if info.LinkedParentJID != (types.JID{}) || info.IsParent {
		subgroups, err := client.GetSubGroups(r.Context(), jid)
		if err == nil {
			for _, sg := range subgroups {
				linkedGroups = append(linkedGroups, map[string]string{
					"jid":  sg.JID.String(),
					"name": sg.Name,
				})
			}
		}
	}

	response.Success(w, map[string]interface{}{
		"jid":          info.JID.String(),
		"name":         info.Name,
		"topic":        info.Topic,
		"isParent":     info.IsParent,
		"linkedGroups": linkedGroups,
	})
}

// --- Helpers ---

func (h *Handler) getClient(name string) (*whatsmeow.Client, error) {
	if name == "" {
		return nil, fmt.Errorf("nome da conexao e obrigatorio")
	}
	return h.engine.GetClient(name)
}

func parseGroupJID(s string) (types.JID, error) {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "@") {
		jid, err := types.ParseJID(s)
		if err != nil {
			return types.JID{}, fmt.Errorf("JID de grupo invalido: %v", err)
		}
		return jid, nil
	}
	return types.NewJID(s, types.GroupServer), nil
}
