package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port             string
	MasterKey        string
	DatabaseURL      string
	Environment      string
	LogLevel         string
	CORSOrigins      string
	WebhookGlobalURL string
	WebhookSecret    string
	SaveMessages     bool
	ConnectOnStartup bool
	QRCodeMaxCount   int
	CheckUserExists  bool
	WADebug          string
	WebhookMedia     bool
	S3Enabled        bool
	S3Endpoint       string
	S3AccessKey      string
	S3SecretKey      string
	S3Bucket         string
	S3Region         string
	S3UseSSL         bool
	ProxyHost        string
	ProxyPort        string
	ProxyUser        string
	ProxyPass        string
	// Anti-ban: versão do WhatsApp Web
	WAVersionMajor int
	WAVersionMinor int
	WAVersionPatch int
	// Anti-ban: delay padrão antes de enviar mensagens (ms)
	MessageDelayMs int
	// Anti-ban: nome do OS reportado ao WhatsApp
	WAOsName string
}

func Load() (*Config, error) {
	masterKey := os.Getenv("IMPAGO_MASTER_KEY")
	if masterKey == "" {
		return nil, fmt.Errorf("variável IMPAGO_MASTER_KEY é obrigatória")
	}

	dbURL := os.Getenv("IMPAGO_DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("variável IMPAGO_DATABASE_URL é obrigatória")
	}

	return &Config{
		Port:             getEnv("IMPAGO_PORT", "8080"),
		MasterKey:        masterKey,
		DatabaseURL:      dbURL,
		Environment:      getEnv("IMPAGO_ENVIRONMENT", "development"),
		LogLevel:         getEnv("IMPAGO_LOG_LEVEL", "info"),
		CORSOrigins:      getEnv("IMPAGO_CORS_ORIGINS", "*"),
		WebhookGlobalURL: getEnv("IMPAGO_WEBHOOK_GLOBAL_URL", ""),
		WebhookSecret:    getEnv("IMPAGO_WEBHOOK_SECRET", ""),
		SaveMessages:     getEnvBool("IMPAGO_SAVE_MESSAGES", true),
		ConnectOnStartup: getEnvBool("IMPAGO_CONNECT_ON_STARTUP", false),
		QRCodeMaxCount:   getEnvInt("IMPAGO_QRCODE_MAX_COUNT", 5),
		CheckUserExists:  getEnvBool("IMPAGO_CHECK_USER_EXISTS", true),
		WADebug:          getEnv("IMPAGO_WA_DEBUG", ""),
		WebhookMedia:     getEnvBool("IMPAGO_WEBHOOK_MEDIA", true),
		S3Enabled:        getEnvBool("IMPAGO_S3_ENABLED", false),
		S3Endpoint:       getEnv("IMPAGO_S3_ENDPOINT", ""),
		S3AccessKey:      getEnv("IMPAGO_S3_ACCESS_KEY", ""),
		S3SecretKey:      getEnv("IMPAGO_S3_SECRET_KEY", ""),
		S3Bucket:         getEnv("IMPAGO_S3_BUCKET", "impago-media"),
		S3Region:         getEnv("IMPAGO_S3_REGION", "us-east-1"),
		S3UseSSL:         getEnvBool("IMPAGO_S3_USE_SSL", false),
		ProxyHost:        getEnv("IMPAGO_PROXY_HOST", ""),
		ProxyPort:        getEnv("IMPAGO_PROXY_PORT", ""),
		ProxyUser:        getEnv("IMPAGO_PROXY_USER", ""),
		ProxyPass:        getEnv("IMPAGO_PROXY_PASS", ""),
		WAVersionMajor:   getEnvInt("IMPAGO_WA_VERSION_MAJOR", 2),
		WAVersionMinor:   getEnvInt("IMPAGO_WA_VERSION_MINOR", 3000),
		WAVersionPatch:   getEnvInt("IMPAGO_WA_VERSION_PATCH", 0),
		MessageDelayMs:   getEnvInt("IMPAGO_MESSAGE_DELAY_MS", 1000),
		WAOsName:         getEnv("IMPAGO_WA_OS_NAME", "Chrome"),
	}, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v == "true" || v == "1" || v == "yes"
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
