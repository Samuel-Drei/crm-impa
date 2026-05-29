package dispatcher

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"impago/internal/engine"
)

type Dispatcher struct {
	client     *http.Client
	webhookURL string
	headers    map[string]string
	maxRetries int
}

func New(webhookURL string) *Dispatcher {
	return &Dispatcher{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		webhookURL: webhookURL,
		headers:    make(map[string]string),
		maxRetries: 3,
	}
}

func (d *Dispatcher) SetGlobalWebhook(url string) {
	d.webhookURL = url
}

func (d *Dispatcher) SetHeader(key, value string) {
	d.headers[key] = value
}

func (d *Dispatcher) Dispatch(event engine.Event) {
	go d.send(event)
}

func (d *Dispatcher) send(event engine.Event) {
	if d.webhookURL == "" {
		return
	}

	body, err := json.Marshal(event)
	if err != nil {
		log.Error().Err(err).Str("event", event.Type).Msg("Falha ao serializar evento")
		return
	}

	var lastErr error
	for attempt := 0; attempt <= d.maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(attempt*attempt) * time.Second
			time.Sleep(delay)
			log.Debug().
				Int("attempt", attempt+1).
				Str("event", event.Type).
				Msg("Reenviando webhook")
		}

		req, err := http.NewRequest(http.MethodPost, d.webhookURL, bytes.NewReader(body))
		if err != nil {
			log.Error().Err(err).Msg("Falha ao criar request de webhook")
			return
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "ImpaGo/1.0")
		for k, v := range d.headers {
			req.Header.Set(k, v)
		}

		resp, err := d.client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Debug().
				Str("event", event.Type).
				Str("connection", event.Connection.Name).
				Int("status", resp.StatusCode).
				Msg("Webhook enviado")
			return
		}

		lastErr = fmt.Errorf("webhook retornou status %d", resp.StatusCode)
	}

	log.Error().
		Err(lastErr).
		Str("event", event.Type).
		Str("connection", event.Connection.Name).
		Str("webhook", d.webhookURL).
		Msg("Falha ao enviar webhook após todas as tentativas")
}
