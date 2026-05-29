package user

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
	"go.mau.fi/whatsmeow/types/events"

	"impago/internal/engine"
	"impago/internal/response"
)

type Handler struct {
	engine *engine.Manager
}

func NewHandler(eng *engine.Manager) *Handler {
	return &Handler{engine: eng}
}

// --- Check User ---

type CheckUserRequest struct {
	Numbers []string `json:"numbers"`
}

func (h *Handler) CheckUser(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req CheckUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jids := make([]string, 0, len(req.Numbers))
	for _, n := range req.Numbers {
		n = cleanNumber(n)
		jids = append(jids, "+"+n)
	}

	results, err := client.IsOnWhatsApp(r.Context(), jids)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao verificar numeros: %v", err))
		return
	}

	data := make([]map[string]interface{}, 0, len(results))
	for _, res := range results {
		data = append(data, map[string]interface{}{
			"query":        res.Query,
			"jid":          res.JID.String(),
			"isRegistered": res.IsIn,
		})
	}

	response.Success(w, data)
}

// --- Get User Info ---

type GetUserRequest struct {
	Numbers []string `json:"numbers"`
}

func (h *Handler) GetUserInfo(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GetUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jids := make([]types.JID, 0, len(req.Numbers))
	for _, n := range req.Numbers {
		jid, err := parseJID(n)
		if err != nil {
			continue
		}
		jids = append(jids, jid)
	}

	infos, err := client.GetUserInfo(r.Context(), jids)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter info dos usuarios: %v", err))
		return
	}

	data := make([]map[string]interface{}, 0, len(infos))
	for jid, info := range infos {
		d := map[string]interface{}{
			"jid":       jid.String(),
			"status":    info.Status,
			"pictureId": info.PictureID,
		}
		if info.Devices != nil {
			devices := make([]string, 0, len(info.Devices))
			for _, dev := range info.Devices {
				devices = append(devices, dev.String())
			}
			d["devices"] = devices
		}
		data = append(data, d)
	}

	response.Success(w, data)
}

// --- Get Avatar ---

type GetAvatarRequest struct {
	Number  string `json:"number"`
	Preview bool   `json:"preview"`
}

func (h *Handler) GetAvatar(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req GetAvatarRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseJID(req.Number)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	extra := whatsmeow.GetProfilePictureParams{}
	if req.Preview {
		extra.Preview = true
	}

	pic, err := client.GetProfilePictureInfo(r.Context(), jid, &extra)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter avatar: %v", err))
		return
	}

	if pic == nil {
		response.Success(w, map[string]string{"url": ""})
		return
	}

	response.Success(w, map[string]interface{}{
		"url":  pic.URL,
		"id":   pic.ID,
		"type": pic.Type,
	})
}

// --- Get Contacts ---

func (h *Handler) GetContacts(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	contacts, err := client.Store.Contacts.GetAllContacts(r.Context())
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter contatos: %v", err))
		return
	}

	data := make([]map[string]string, 0, len(contacts))
	for jid, info := range contacts {
		data = append(data, map[string]string{
			"jid":       jid.String(),
			"fullName":  info.FullName,
			"firstName": info.FirstName,
			"pushName":  info.PushName,
			"business":  info.BusinessName,
		})
	}

	response.Success(w, data)
}

// --- Set Profile Picture ---

type SetProfilePicRequest struct {
	URL string `json:"url"`
}

func (h *Handler) SetProfilePicture(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetProfilePicRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	imgData, err := downloadURL(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar imagem: %v", err))
		return
	}

	myJID := client.Store.ID.ToNonAD()
	_, err = client.SetGroupPhoto(r.Context(), myJID, imgData)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir foto: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Foto de perfil atualizada"})
}

// --- Remove Profile Picture ---

func (h *Handler) RemoveProfilePicture(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	myJID := client.Store.ID.ToNonAD()
	_, err = client.SetGroupPhoto(r.Context(), myJID, nil)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao remover foto: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Foto de perfil removida"})
}

// --- Set Profile Name ---

type SetNameRequest struct {
	Name string `json:"name"`
}

func (h *Handler) SetProfileName(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetNameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	_ = client.SetStatusMessage(r.Context(), req.Name)
	client.Store.PushName = req.Name

	response.Success(w, map[string]string{"message": "Nome de perfil atualizado"})
}

// --- Set Profile Status ---

type SetStatusRequest struct {
	Status string `json:"status"`
}

func (h *Handler) SetProfileStatus(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	err = client.SetStatusMessage(r.Context(), req.Status)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao definir status: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Status de perfil atualizado"})
}

// --- Get Privacy Settings ---

func (h *Handler) GetPrivacy(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	privacy, err := client.TryFetchPrivacySettings(r.Context(), false)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter privacidade: %v", err))
		return
	}

	response.Success(w, map[string]interface{}{
		"groupAdd":     string(privacy.GroupAdd),
		"lastSeen":     string(privacy.LastSeen),
		"status":       string(privacy.Status),
		"profile":      string(privacy.Profile),
		"readReceipts": string(privacy.ReadReceipts),
		"callAdd":      string(privacy.CallAdd),
		"online":       string(privacy.Online),
	})
}

// --- Set Privacy Settings ---

type SetPrivacyRequest struct {
	GroupAdd     string `json:"groupAdd,omitempty"`
	LastSeen     string `json:"lastSeen,omitempty"`
	Status       string `json:"status,omitempty"`
	Profile      string `json:"profile,omitempty"`
	ReadReceipts string `json:"readReceipts,omitempty"`
	Online       string `json:"online,omitempty"`
}

func (h *Handler) SetPrivacy(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req SetPrivacyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.GroupAdd != "" {
		_, err = client.SetPrivacySetting(r.Context(), types.PrivacySettingTypeGroupAdd, types.PrivacySetting(req.GroupAdd))
		if err != nil {
			response.Internal(w, fmt.Sprintf("Falha ao definir privacidade: %v", err))
			return
		}
	}
	if req.LastSeen != "" {
		_, _ = client.SetPrivacySetting(r.Context(), types.PrivacySettingTypeLastSeen, types.PrivacySetting(req.LastSeen))
	}
	if req.Status != "" {
		_, _ = client.SetPrivacySetting(r.Context(), types.PrivacySettingTypeStatus, types.PrivacySetting(req.Status))
	}
	if req.Profile != "" {
		_, _ = client.SetPrivacySetting(r.Context(), types.PrivacySettingTypeProfile, types.PrivacySetting(req.Profile))
	}
	if req.ReadReceipts != "" {
		_, _ = client.SetPrivacySetting(r.Context(), types.PrivacySettingTypeReadReceipts, types.PrivacySetting(req.ReadReceipts))
	}
	if req.Online != "" {
		_, _ = client.SetPrivacySetting(r.Context(), types.PrivacySettingTypeOnline, types.PrivacySetting(req.Online))
	}

	response.Success(w, map[string]string{"message": "Privacidade atualizada"})
}

// --- Block/Unblock Contact ---

type BlockRequest struct {
	Number string `json:"number"`
}

func (h *Handler) BlockContact(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req BlockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseJID(req.Number)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	_, err = client.UpdateBlocklist(r.Context(), jid, events.BlocklistChangeActionBlock)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao bloquear: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Contato bloqueado"})
}

func (h *Handler) UnblockContact(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req BlockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseJID(req.Number)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	_, err = client.UpdateBlocklist(r.Context(), jid, events.BlocklistChangeActionUnblock)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao desbloquear: %v", err))
		return
	}

	response.Success(w, map[string]string{"message": "Contato desbloqueado"})
}

// --- Get Block List ---

func (h *Handler) GetBlockList(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	blocklist, err := client.GetBlocklist(r.Context())
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter lista de bloqueados: %v", err))
		return
	}

	response.Success(w, blocklist)
}

// --- Fetch Business Profile ---

type BusinessProfileRequest struct {
	Number string `json:"number"`
}

func (h *Handler) FetchBusinessProfile(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req BusinessProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	jid, err := parseJID(req.Number)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	profile, err := client.GetBusinessProfile(r.Context(), jid)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao obter perfil comercial: %v", err))
		return
	}

	response.Success(w, profile)
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
	number = cleanNumber(number)

	if strings.Contains(number, "@") {
		jid, err := types.ParseJID(number)
		if err != nil {
			return types.JID{}, fmt.Errorf("JID invalido: %v", err)
		}
		return jid, nil
	}

	return types.NewJID(number, types.DefaultUserServer), nil
}

func cleanNumber(n string) string {
	n = strings.ReplaceAll(n, "+", "")
	n = strings.ReplaceAll(n, " ", "")
	n = strings.ReplaceAll(n, "-", "")
	n = strings.ReplaceAll(n, "(", "")
	n = strings.ReplaceAll(n, ")", "")
	return n
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
