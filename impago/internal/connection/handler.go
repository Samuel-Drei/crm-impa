package connection

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"impago/internal/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	if input.Name == "" {
		response.BadRequest(w, "Campo 'name' é obrigatório")
		return
	}

	result, err := h.service.Create(input)
	if err != nil {
		if isConflict(err) {
			response.Conflict(w, err.Error())
			return
		}
		if isValidation(err) {
			response.BadRequest(w, err.Error())
			return
		}
		response.Internal(w, err.Error())
		return
	}

	response.JSON(w, http.StatusCreated, result)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	conn, err := h.service.GetByName(name)
	if err != nil {
		response.NotFound(w, "Conexão não encontrada")
		return
	}

	response.Success(w, conn)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}

	conns, total, err := h.service.GetAll(page, limit)
	if err != nil {
		response.Internal(w, "Falha ao listar conexões")
		return
	}

	response.JSON(w, http.StatusOK, map[string]interface{}{
		"data":  conns,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	var input UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		response.BadRequest(w, "Corpo da requisição inválido")
		return
	}

	conn, err := h.service.Update(name, input)
	if err != nil {
		if isNotFound(err) {
			response.NotFound(w, "Conexão não encontrada")
			return
		}
		response.Internal(w, err.Error())
		return
	}

	response.Success(w, conn)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	if err := h.service.Delete(name); err != nil {
		if isNotFound(err) {
			response.NotFound(w, "Conexão não encontrada")
			return
		}
		response.Internal(w, err.Error())
		return
	}

	response.JSON(w, http.StatusOK, map[string]string{
		"message": "Conexão removida com sucesso",
	})
}

// --- Session endpoints ---

func (h *Handler) StartSession(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	if err := h.service.StartSession(name); err != nil {
		if isNotFound(err) {
			response.NotFound(w, "Conexão não encontrada")
			return
		}
		response.Internal(w, err.Error())
		return
	}

	response.JSON(w, http.StatusOK, map[string]string{
		"message": "Sessão iniciada",
	})
}

func (h *Handler) StopSession(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	if err := h.service.StopSession(name); err != nil {
		response.Internal(w, err.Error())
		return
	}

	response.JSON(w, http.StatusOK, map[string]string{
		"message": "Sessão parada",
	})
}

func (h *Handler) RestartSession(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	if err := h.service.RestartSession(name); err != nil {
		response.Internal(w, err.Error())
		return
	}

	response.JSON(w, http.StatusOK, map[string]string{
		"message": "Sessão reiniciada",
	})
}

func (h *Handler) LogoutSession(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	if err := h.service.LogoutSession(name); err != nil {
		response.Internal(w, err.Error())
		return
	}

	response.JSON(w, http.StatusOK, map[string]string{
		"message": "Logout realizado",
	})
}

func (h *Handler) GetStatus(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	status, err := h.service.GetStatus(name)
	if err != nil {
		response.Internal(w, err.Error())
		return
	}

	response.Success(w, status)
}

func (h *Handler) GetQRCode(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	qr, err := h.service.GetQRCode(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	response.Success(w, qr)
}

func (h *Handler) PairPhone(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		response.BadRequest(w, "Nome da conexão é obrigatório")
		return
	}

	var body struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Phone == "" {
		response.BadRequest(w, "Campo 'phone' é obrigatório")
		return
	}

	code, err := h.service.PairPhone(name, body.Phone)
	if err != nil {
		response.Internal(w, err.Error())
		return
	}

	response.Success(w, map[string]string{
		"code": code,
	})
}

// --- Helpers de erro ---

func isConflict(err error) bool {
	return contains(err.Error(), "já existe")
}

func isNotFound(err error) bool {
	return contains(err.Error(), "não encontrad") || contains(err.Error(), "record not found")
}

func isValidation(err error) bool {
	return contains(err.Error(), "inválido") || contains(err.Error(), "obrigatório")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
