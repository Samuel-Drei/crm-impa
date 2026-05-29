package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"impago/internal/call"
	"impago/internal/chat"
	"impago/internal/community"
	"impago/internal/config"
	"impago/internal/connection"
	"impago/internal/database"
	"impago/internal/dispatcher"
	"impago/internal/engine"
	"impago/internal/group"
	"impago/internal/label"
	"impago/internal/messaging"
	"impago/internal/newsletter"
	"impago/internal/router"
	"impago/internal/user"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339

	if os.Getenv("IMPAGO_LOG_PRETTY") == "true" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: "15:04:05"})
	}

	log.Info().Msg("═══════════════════════════════════════")
	log.Info().Msg("  ImpaGo API — WhatsApp Gateway v1.0  ")
	log.Info().Msg("═══════════════════════════════════════")

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("Falha ao carregar configuração")
	}

	level, _ := zerolog.ParseLevel(cfg.LogLevel)
	zerolog.SetGlobalLevel(level)

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("Falha ao conectar ao banco de dados")
	}

	if err := db.AutoMigrate(&connection.Connection{}, &connection.Message{}); err != nil {
		log.Fatal().Err(err).Msg("Falha na migração do banco de dados")
	}
	log.Info().Msg("Migrações do banco de dados aplicadas")

	disp := dispatcher.New(cfg.WebhookGlobalURL)
	if cfg.WebhookSecret != "" {
		disp.SetHeader("X-Webhook-Secret", cfg.WebhookSecret)
	}

	eng, err := engine.NewManager(cfg, disp)
	if err != nil {
		log.Fatal().Err(err).Msg("Falha ao inicializar engine WhatsApp")
	}

	connRepo := connection.NewRepository(db)
	connService := connection.NewService(connRepo, eng)
	connHandler := connection.NewHandler(connService)

	msgHandler := messaging.NewHandler(eng, cfg)
	chatHandler := chat.NewHandler(eng)
	groupHandler := group.NewHandler(eng)
	userHandler := user.NewHandler(eng)
	labelHandler := label.NewHandler(eng)
	communityHandler := community.NewHandler(eng)
	newsletterHandler := newsletter.NewHandler(eng)
	callHandler := call.NewHandler(eng)

	handler := router.New(cfg, connHandler, msgHandler, chatHandler, groupHandler, userHandler, labelHandler, communityHandler, newsletterHandler, callHandler, connRepo)

	addr := fmt.Sprintf(":%s", cfg.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info().
			Str("port", cfg.Port).
			Str("mode", cfg.Environment).
			Msg("Servidor HTTP iniciado")

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Falha no servidor HTTP")
		}
	}()

	go func() {
		time.Sleep(2 * time.Second)
		log.Info().Msg("Reconectando sessões ativas...")
		connService.ReconnectAll()
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	log.Info().Str("signal", sig.String()).Msg("Desligamento graceful iniciado")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Error().Err(err).Msg("Falha no desligamento do servidor")
	}

	log.Info().Msg("ImpaGo API encerrado")
}
