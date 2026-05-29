package middleware

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"impago/internal/connection"
	"impago/internal/response"
)

type contextKey string

const ConnectionKey contextKey = "connection"

func MasterKeyAuth(masterKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r)
			if token == "" {
				response.Error(w, http.StatusUnauthorized, "Token de autenticação é obrigatório")
				return
			}

			if subtle.ConstantTimeCompare([]byte(token), []byte(masterKey)) != 1 {
				response.Error(w, http.StatusUnauthorized, "Master key inválida")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func ConnectionAuth(repo *connection.Repository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r)
			if token == "" {
				response.Error(w, http.StatusUnauthorized, "Token de autenticação é obrigatório")
				return
			}

			hash := hashToken(token)
			conn, err := repo.GetByTokenHash(hash)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, "Token inválido")
				return
			}

			ctx := context.WithValue(r.Context(), ConnectionKey, conn)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func DualAuth(masterKey string, repo *connection.Repository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r)
			if token == "" {
				response.Error(w, http.StatusUnauthorized, "Token de autenticação é obrigatório")
				return
			}

			if subtle.ConstantTimeCompare([]byte(token), []byte(masterKey)) == 1 {
				next.ServeHTTP(w, r)
				return
			}

			hash := hashToken(token)
			conn, err := repo.GetByTokenHash(hash)
			if err != nil {
				response.Error(w, http.StatusUnauthorized, "Token inválido")
				return
			}

			ctx := context.WithValue(r.Context(), ConnectionKey, conn)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetConnection(r *http.Request) *connection.Connection {
	conn, _ := r.Context().Value(ConnectionKey).(*connection.Connection)
	return conn
}

func CORS(allowedOrigins string) func(http.Handler) http.Handler {
	origins := strings.Split(allowedOrigins, ",")
	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			allowed := false
			for _, o := range origins {
				if o == "*" || o == origin {
					allowed = true
					break
				}
			}

			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}

			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-ID")
		if reqID != "" {
			w.Header().Set("X-Request-ID", reqID)
		}
		next.ServeHTTP(w, r)
	})
}

func extractToken(r *http.Request) string {
	// Header: apikey (compatível com EvoGo/Evolution API)
	if token := r.Header.Get("apikey"); token != "" {
		return token
	}

	// Header: Authorization: Bearer <token>
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}

	// Query param: ?token=<token>
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}

	return ""
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
