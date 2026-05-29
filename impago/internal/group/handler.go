package group

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

// --- List Groups ---

func (h *Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	groups, err := client.GetJoinedGroups(r.Context())
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao listar grupos: %v", err))
		return
	}

	result := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		result = append(result, map[string]interface{}{
			"jid":          g.JID.String(),
			"name":         g.Name,
			"topic":        g.Topic,
			"participants": len(g.Participants),
			"isLocked":     g.IsLocked,
			"isAnnounce":   g.IsAnnounce,
			"owner":        g.OwnerJID.String(),
			"created":      g.GroupCreated,
		})
	}

	response.Success(w, result)
}

// --- Get Group Info ---

type GroupInfoRequest struct {
	GroupJID string `json:"groupJid"`
}

func (h *Handler) GetGroupInfo(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	info, err := client.GetGroupInfo(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter info do grupo: %v", err))
		return
	}

	participants := make([]map[string]interface{}, 0, len(info.Participants))
	for _, p := range info.Participants {
		participants = append(participants, map[string]interface{}{
			"jid":          p.JID.String(),
			"isAdmin":      p.IsAdmin,
			"isSuperAdmin": p.IsSuperAdmin,
		})
	}

	response.Success(w, map[string]interface{}{
		"jid":          info.JID.String(),
		"name":         info.Name,
		"topic":        info.Topic,
		"topicId":      info.TopicID,
		"topicSetBy":   info.TopicSetBy.String(),
		"owner":        info.OwnerJID.String(),
		"participants": participants,
		"isLocked":     info.IsLocked,
		"isAnnounce":   info.IsAnnounce,
		"isEphemeral":  info.IsEphemeral,
		"created":      info.GroupCreated,
	})
}

// --- Create Group ---

type CreateGroupRequest struct {
	Name         string   `json:"name"`
	Participants []string `json:"participants"`
}

func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req CreateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.Name == "" {
		response.BadRequest(w, "Campo 'name' e obrigatorio")
		return
	}

	jids := make([]types.JID, 0, len(req.Participants))
	for _, p := range req.Participants {
		pJid, err := parseJID(p)
		if err != nil {
			continue
		}
		jids = append(jids, pJid)
	}

	info, err := client.CreateGroup(r.Context(), whatsmeow.ReqCreateGroup{
		Name:         req.Name,
		Participants: jids,
	})
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao criar grupo: %v", err))
		return
	}

	response.JSON(w, http.StatusCreated, map[string]interface{}{
		"jid":  info.JID.String(),
		"name": info.Name,
	})
}

// --- Get Invite Link ---

func (h *Handler) GetInviteLink(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	link, err := client.GetGroupInviteLink(r.Context(), jid, false)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter link de convite: %v", err))
		return
	}

	response.Success(w, map[string]string{"inviteLink": link})
}

// --- Revoke Invite Link ---

func (h *Handler) RevokeInviteLink(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	link, err := client.GetGroupInviteLink(r.Context(), jid, true)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao revogar link de convite: %v", err))
		return
	}

	response.Success(w, map[string]string{"inviteLink": link})
}

// --- Join Group ---

type JoinGroupRequest struct {
	InviteCode string `json:"inviteCode"`
}

func (h *Handler) JoinGroup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req JoinGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	code := req.InviteCode
	code = strings.TrimPrefix(code, "https://chat.whatsapp.com/")

	jid, err := client.JoinGroupWithLink(r.Context(), code)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao entrar no grupo: %v", err))
		return
	}

	response.Success(w, map[string]string{"groupJid": jid.String()})
}

// --- Leave Group ---

func (h *Handler) LeaveGroup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.LeaveGroup(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao sair do grupo: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Saiu do grupo"})
}

// --- Set Group Photo ---

type SetGroupPhotoRequest struct {
	GroupJID string `json:"groupJid"`
	URL      string `json:"url"`
}

func (h *Handler) SetGroupPhoto(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetGroupPhotoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	imgData, err := downloadURL(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar imagem: %v", err))
		return
	}

	_, err = client.SetGroupPhoto(r.Context(), jid, imgData)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir foto: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Foto do grupo atualizada"})
}

// --- Set Group Name ---

type SetGroupNameRequest struct {
	GroupJID string `json:"groupJid"`
	Name     string `json:"name"`
}

func (h *Handler) SetGroupName(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetGroupNameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SetGroupName(r.Context(), jid, req.Name)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir nome: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Nome do grupo atualizado"})
}

// --- Set Group Description ---

type SetGroupDescRequest struct {
	GroupJID    string `json:"groupJid"`
	Description string `json:"description"`
}

func (h *Handler) SetGroupDescription(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetGroupDescRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	err = client.SetGroupTopic(r.Context(), jid, "", "", req.Description)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir descricao: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Descricao do grupo atualizada"})
}

// --- Update Participant ---

type UpdateParticipantRequest struct {
	GroupJID     string   `json:"groupJid"`
	Participants []string `json:"participants"`
	Action       string   `json:"action"` // add, remove, promote, demote
}

func (h *Handler) UpdateParticipant(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req UpdateParticipantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	jids := make([]types.JID, 0, len(req.Participants))
	for _, p := range req.Participants {
		pJid, err := parseJID(p)
		if err != nil {
			continue
		}
		jids = append(jids, pJid)
	}

	var participants []types.GroupParticipant
	switch req.Action {
	case "add":
		participants, err = client.UpdateGroupParticipants(r.Context(), jid, jids, whatsmeow.ParticipantChangeAdd)
	case "remove":
		participants, err = client.UpdateGroupParticipants(r.Context(), jid, jids, whatsmeow.ParticipantChangeRemove)
	case "promote":
		participants, err = client.UpdateGroupParticipants(r.Context(), jid, jids, whatsmeow.ParticipantChangePromote)
	case "demote":
		participants, err = client.UpdateGroupParticipants(r.Context(), jid, jids, whatsmeow.ParticipantChangeDemote)
	default:
		response.BadRequest(w, "Acao invalida. Use: add, remove, promote, demote")
		return
	}

	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao atualizar participantes: %v", err))
		return
	}

	result := make([]map[string]interface{}, 0, len(participants))
	for _, p := range participants {
		result = append(result, map[string]interface{}{
			"jid":     p.JID.String(),
			"isAdmin": p.IsAdmin,
		})
	}

	response.Success(w, result)
}

// --- Update Group Settings ---

type GroupSettingsRequest struct {
	GroupJID string `json:"groupJid"`
	Announce *bool  `json:"announce,omitempty"`
	Locked   *bool  `json:"locked,omitempty"`
}

func (h *Handler) UpdateGroupSettings(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	if req.Announce != nil {
		err = client.SetGroupAnnounce(r.Context(), jid, *req.Announce)
		if err != nil {
			response.Internal(w, fmt.Sprintf("Falha ao alterar configuracao announce: %v", err))
			return
		}
	}

	if req.Locked != nil {
		err = client.SetGroupLocked(r.Context(), jid, *req.Locked)
		if err != nil {
			response.Internal(w, fmt.Sprintf("Falha ao alterar configuracao locked: %v", err))
			return
		}
	}

	response.Success(w, map[string]string{"message": "Configuracoes do grupo atualizadas"})
}

// --- Get Group Request Participants ---

func (h *Handler) GetGroupRequests(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	participants, err := client.GetGroupRequestParticipants(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter solicitacoes: %v", err))
		return
	}

	result := make([]map[string]string, 0, len(participants))
	for _, p := range participants {
		result = append(result, map[string]string{
			"jid": p.JID.String(),
		})
	}

	response.Success(w, result)
}

// --- Action on Group Requests ---

type GroupRequestActionRequest struct {
	GroupJID     string   `json:"groupJid"`
	Participants []string `json:"participants"`
	Action       string   `json:"action"` // approve, reject
}

func (h *Handler) ActionGroupRequests(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GroupRequestActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	jids := make([]types.JID, 0, len(req.Participants))
	for _, p := range req.Participants {
		pJid, err := parseJID(p)
		if err != nil {
			continue
		}
		jids = append(jids, pJid)
	}

	var action whatsmeow.ParticipantRequestChange
	switch req.Action {
	case "approve":
		action = whatsmeow.ParticipantChangeApprove
	case "reject":
		action = whatsmeow.ParticipantChangeReject
	default:
		response.BadRequest(w, "Acao invalida. Use: approve, reject")
		return
	}

	_, err = client.UpdateGroupRequestParticipants(r.Context(), jid, jids, action)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao processar solicitacoes: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Solicitacoes processadas"})
}

// --- Toggle Ephemeral ---

type EphemeralRequest struct {
	GroupJID   string `json:"groupJid"`
	Expiration int64  `json:"expiration"` // 0=off, 86400=24h, 604800=7d, 7776000=90d
}

func (h *Handler) ToggleEphemeral(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req EphemeralRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseGroupJID(req.GroupJID)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	duration := time.Duration(req.Expiration) * time.Second
	err = client.SetDisappearingTimer(r.Context(), jid, duration, time.Now())
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir mensagens efemeras: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Mensagens efemeras atualizadas"})
}

// --- Invite Info ---

type InviteInfoRequest struct {
	InviteCode string `json:"inviteCode"`
}

func (h *Handler) InviteInfo(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req InviteInfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	code := strings.TrimPrefix(req.InviteCode, "https://chat.whatsapp.com/")

	info, err := client.GetGroupInfoFromLink(r.Context(), code)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter info do convite: %v", err))
		return
	}

	response.Success(w, map[string]interface{}{
		"jid":          info.JID.String(),
		"name":         info.Name,
		"topic":        info.Topic,
		"participants": len(info.Participants),
		"owner":        info.OwnerJID.String(),
	})
}

// --- Helpers ---

func (h *Handler) getClient(name string) (*whatsmeow.Client, error) {
	if name == "" {
		return nil, fmt.Errorf("nome da conexao e obrigatorio")
	}
	return h.engine.GetClient(name)
}

func parseGroupJID(groupJid string) (types.JID, error) {
	groupJid = strings.TrimSpace(groupJid)
	if groupJid == "" {
		return types.JID{}, fmt.Errorf("groupJid e obrigatorio")
	}
	if strings.Contains(groupJid, "@") {
		jid, err := types.ParseJID(groupJid)
		if err != nil {
			return types.JID{}, fmt.Errorf("JID de grupo invalido: %v", err)
		}
		return jid, nil
	}
	return types.NewJID(groupJid, types.GroupServer), nil
}

func parseJID(number string) (types.JID, error) {
	number = strings.TrimSpace(number)
	number = strings.ReplaceAll(number, "+", "")
	number = strings.ReplaceAll(number, " ", "")
	number = strings.ReplaceAll(number, "-", "")

	if strings.Contains(number, "@") {
		jid, err := types.ParseJID(number)
		if err != nil {
			return types.JID{}, fmt.Errorf("JID invalido: %v", err)
		}
		return jid, nil
	}

	return types.NewJID(number, types.DefaultUserServer), nil
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

	const maxSize = 50 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSize))
	if err != nil {
		return nil, fmt.Errorf("falha ao ler dados: %v", err)
	}

	return data, nil
}
