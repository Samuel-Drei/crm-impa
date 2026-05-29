package response

import (
	"encoding/json"
	"net/http"
)

type APIResponse struct {
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
}

type APIError struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
}

func JSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func Success(w http.ResponseWriter, data interface{}) {
	JSON(w, http.StatusOK, APIResponse{Data: data})
}

func SuccessMessage(w http.ResponseWriter, msg string) {
	JSON(w, http.StatusOK, APIResponse{Message: msg})
}

func Error(w http.ResponseWriter, status int, detail string) {
	JSON(w, status, APIError{
		Type:   errorType(status),
		Title:  statusTitle(status),
		Status: status,
		Detail: detail,
	})
}

func BadRequest(w http.ResponseWriter, detail string) {
	Error(w, http.StatusBadRequest, detail)
}

func Unauthorized(w http.ResponseWriter) {
	Error(w, http.StatusUnauthorized, "Token de autenticação inválido ou ausente")
}

func NotFound(w http.ResponseWriter, detail string) {
	Error(w, http.StatusNotFound, detail)
}

func Conflict(w http.ResponseWriter, detail string) {
	Error(w, http.StatusConflict, detail)
}

func Internal(w http.ResponseWriter, detail string) {
	Error(w, http.StatusInternalServerError, detail)
}

func statusTitle(status int) string {
	switch status {
	case 400:
		return "Bad Request"
	case 401:
		return "Unauthorized"
	case 403:
		return "Forbidden"
	case 404:
		return "Not Found"
	case 409:
		return "Conflict"
	case 429:
		return "Too Many Requests"
	default:
		return "Internal Server Error"
	}
}

func errorType(status int) string {
	switch status {
	case 400:
		return "bad_request"
	case 401:
		return "unauthorized"
	case 404:
		return "not_found"
	case 409:
		return "conflict"
	case 429:
		return "rate_limited"
	default:
		return "internal_error"
	}
}
