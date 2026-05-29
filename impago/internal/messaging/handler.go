package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	waCommon "go.mau.fi/whatsmeow/proto/waCommon"
	"google.golang.org/protobuf/proto"

	"impago/internal/config"
	"impago/internal/engine"
	"impago/internal/response"
)

type Handler struct {
	engine *engine.Manager
	config *config.Config
}

func NewHandler(eng *engine.Manager, cfg *config.Config) *Handler {
	return &Handler{engine: eng, config: cfg}
}

// simulateTyping envia indicador de "digitando..." com delay antes do envio (anti-ban)
func (h *Handler) simulateTyping(client *whatsmeow.Client, jid types.JID, delayMs int, mediaType string) {
	if delayMs <= 0 {
		delayMs = h.config.MessageDelayMs
	}
	if delayMs <= 0 {
		return
	}

	// Determinar tipo de presence media
	var media types.ChatPresenceMedia
	if mediaType == "audio" {
		media = types.ChatPresenceMediaAudio
	}

	// 1. Enviar "digitando..."
	_ = client.SendChatPresence(context.Background(), jid, types.ChatPresence("composing"), media)

	// 2. Aguardar delay
	time.Sleep(time.Duration(delayMs) * time.Millisecond)

	// 3. Enviar "parou de digitar"
	_ = client.SendChatPresence(context.Background(), jid, types.ChatPresence("paused"), media)
}

// sendWithDelay envia mensagem com simulação de digitação anti-ban
func (h *Handler) sendWithDelay(client *whatsmeow.Client, jid types.JID, msg *waE2E.Message, delayMs int, mediaType string) (whatsmeow.SendResponse, error) {
	h.simulateTyping(client, jid, delayMs, mediaType)
	return client.SendMessage(context.Background(), jid, msg)
}

type TextRequest struct {
	To    string `json:"to"`
	Text  string `json:"text"`
	Delay int    `json:"delay,omitempty"` // delay em ms antes de enviar (anti-ban)
}

type MediaRequest struct {
	To       string `json:"to"`
	URL      string `json:"url,omitempty"`
	Caption  string `json:"caption,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	FileName string `json:"fileName,omitempty"`
	Delay    int    `json:"delay,omitempty"`
}

type LocationRequest struct {
	To        string  `json:"to"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name,omitempty"`
	Address   string  `json:"address,omitempty"`
	Delay     int     `json:"delay,omitempty"`
}

type ContactRequest struct {
	To    string `json:"to"`
	VCard string `json:"vcard"`
	Name  string `json:"name"`
	Delay int    `json:"delay,omitempty"`
}

type ReactionRequest struct {
	To        string `json:"to"`
	MessageID string `json:"messageId"`
	Emoji     string `json:"emoji"`
}

type SendResult struct {
	MessageID string `json:"messageId"`
	Timestamp string `json:"timestamp"`
	To        string `json:"to"`
}

func (h *Handler) SendText(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req TextRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.Text == "" {
		response.BadRequest(w, "Campos 'to' e 'text' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String(req.Text),
		},
	}

	// Anti-ban: simular digitação antes de enviar
	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar mensagem: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendImage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MediaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	mediaBytes, err := downloadMedia(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar midia: %v", err))
		return
	}

	uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaImage)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha no upload de midia: %v", err))
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	msg := &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(mediaBytes))),
			Mimetype:      proto.String(mimeType),
			Caption:       proto.String(req.Caption),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "image")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar imagem: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendAudio(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MediaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	mediaBytes, err := downloadMedia(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar audio: %v", err))
		return
	}

	uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaAudio)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha no upload de audio: %v", err))
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "audio/ogg; codecs=opus"
	}

	msg := &waE2E.Message{
		AudioMessage: &waE2E.AudioMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(mediaBytes))),
			Mimetype:      proto.String(mimeType),
			PTT:           proto.Bool(true),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "audio")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar audio: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendDocument(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MediaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	mediaBytes, err := downloadMedia(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar documento: %v", err))
		return
	}

	uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaDocument)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha no upload de documento: %v", err))
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	fileName := req.FileName
	if fileName == "" {
		fileName = "document"
	}

	msg := &waE2E.Message{
		DocumentMessage: &waE2E.DocumentMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(mediaBytes))),
			Mimetype:      proto.String(mimeType),
			FileName:      proto.String(fileName),
			Caption:       proto.String(req.Caption),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "document")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar documento: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendVideo(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req MediaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	mediaBytes, err := downloadMedia(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar video: %v", err))
		return
	}

	uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaVideo)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha no upload de video: %v", err))
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "video/mp4"
	}

	msg := &waE2E.Message{
		VideoMessage: &waE2E.VideoMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(mediaBytes))),
			Mimetype:      proto.String(mimeType),
			Caption:       proto.String(req.Caption),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "video")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar video: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendLocation(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req LocationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" {
		response.BadRequest(w, "Campo 'to' e obrigatorio")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	msg := &waE2E.Message{
		LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(req.Latitude),
			DegreesLongitude: proto.Float64(req.Longitude),
			Name:             proto.String(req.Name),
			Address:          proto.String(req.Address),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar localizacao: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendContact(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.VCard == "" {
		response.BadRequest(w, "Campos 'to' e 'vcard' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: proto.String(req.Name),
			Vcard:       proto.String(req.VCard),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, req.Delay, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar contato: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

func (h *Handler) SendReaction(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ReactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.MessageID == "" {
		response.BadRequest(w, "Campos 'to' e 'messageId' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	msg := &waE2E.Message{
		ReactionMessage: &waE2E.ReactionMessage{
			Key: &waCommon.MessageKey{
				RemoteJID: proto.String(req.To),
				ID:        proto.String(req.MessageID),
				FromMe:    proto.Bool(true),
			},
			Text: proto.String(req.Emoji),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar reacao: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Send Poll ---

type PollRequest struct {
	To              string   `json:"to"`
	Name            string   `json:"name"`
	Options         []string `json:"options"`
	SelectableCount int      `json:"selectableCount"`
}

func (h *Handler) SendPoll(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req PollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.Name == "" || len(req.Options) < 2 {
		response.BadRequest(w, "Campos 'to', 'name' e pelo menos 2 'options' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	selectCount := req.SelectableCount
	if selectCount <= 0 {
		selectCount = 1
	}

	pollOptions := make([]*waE2E.PollCreationMessage_Option, 0, len(req.Options))
	for _, opt := range req.Options {
		pollOptions = append(pollOptions, &waE2E.PollCreationMessage_Option{
			OptionName: proto.String(opt),
		})
	}

	msg := &waE2E.Message{
		PollCreationMessage: &waE2E.PollCreationMessage{
			Name:                   proto.String(req.Name),
			Options:                pollOptions,
			SelectableOptionsCount: proto.Uint32(uint32(selectCount)),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar enquete: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Send Sticker ---

type StickerRequest struct {
	To       string `json:"to"`
	URL      string `json:"url"`
	MimeType string `json:"mimeType,omitempty"`
}

func (h *Handler) SendSticker(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req StickerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	mediaBytes, err := downloadMedia(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar sticker: %v", err))
		return
	}

	uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaImage)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha no upload de sticker: %v", err))
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "image/webp"
	}

	msg := &waE2E.Message{
		StickerMessage: &waE2E.StickerMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(mediaBytes))),
			Mimetype:      proto.String(mimeType),
			IsAnimated:    proto.Bool(strings.Contains(mimeType, "webp")),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar sticker: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Send Link Preview ---

type LinkRequest struct {
	To          string `json:"to"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Text        string `json:"text"`
	ThumbURL    string `json:"thumbUrl,omitempty"`
}

func (h *Handler) SendLink(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req LinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	text := req.Text
	if text == "" {
		text = req.URL
	}

	linkMsg := &waE2E.ExtendedTextMessage{
		Text:        proto.String(text),
		MatchedText: proto.String(req.URL),
		Title:       proto.String(req.Title),
		Description: proto.String(req.Description),
		PreviewType: waE2E.ExtendedTextMessage_NONE.Enum(),
	}

	if req.ThumbURL != "" {
		thumbBytes, err := downloadMedia(req.ThumbURL)
		if err == nil {
			linkMsg.JPEGThumbnail = thumbBytes
		}
	}

	msg := &waE2E.Message{
		ExtendedTextMessage: linkMsg,
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar link: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Send Buttons ---

type ButtonItem struct {
	ButtonID    string `json:"buttonId"`
	DisplayText string `json:"displayText"`
}

type ButtonRequest struct {
	To      string       `json:"to"`
	Text    string       `json:"text"`
	Footer  string       `json:"footer"`
	Buttons []ButtonItem `json:"buttons"`
}

func (h *Handler) SendButton(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ButtonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.Text == "" || len(req.Buttons) == 0 {
		response.BadRequest(w, "Campos 'to', 'text' e 'buttons' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	buttons := make([]*waE2E.ButtonsMessage_Button, 0, len(req.Buttons))
	for i, btn := range req.Buttons {
		btnID := btn.ButtonID
		if btnID == "" {
			btnID = fmt.Sprintf("btn_%d", i)
		}
		buttons = append(buttons, &waE2E.ButtonsMessage_Button{
			ButtonID: proto.String(btnID),
			ButtonText: &waE2E.ButtonsMessage_Button_ButtonText{
				DisplayText: proto.String(btn.DisplayText),
			},
			Type: waE2E.ButtonsMessage_Button_RESPONSE.Enum(),
		})
	}

	msg := &waE2E.Message{
		ButtonsMessage: &waE2E.ButtonsMessage{
			ContentText: proto.String(req.Text),
			FooterText:  proto.String(req.Footer),
			Buttons:     buttons,
			HeaderType:  waE2E.ButtonsMessage_EMPTY.Enum(),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar botoes: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Send List ---

type ListRow struct {
	RowID       string `json:"rowId"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type ListSection struct {
	Title string    `json:"title"`
	Rows  []ListRow `json:"rows"`
}

type ListRequest struct {
	To         string        `json:"to"`
	Title      string        `json:"title"`
	Text       string        `json:"text"`
	Footer     string        `json:"footer"`
	ButtonText string        `json:"buttonText"`
	Sections   []ListSection `json:"sections"`
}

func (h *Handler) SendList(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req ListRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.Text == "" || len(req.Sections) == 0 {
		response.BadRequest(w, "Campos 'to', 'text' e 'sections' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	sections := make([]*waE2E.ListMessage_Section, 0, len(req.Sections))
	for _, sec := range req.Sections {
		rows := make([]*waE2E.ListMessage_Row, 0, len(sec.Rows))
		for _, row := range sec.Rows {
			rows = append(rows, &waE2E.ListMessage_Row{
				RowID:       proto.String(row.RowID),
				Title:       proto.String(row.Title),
				Description: proto.String(row.Description),
			})
		}
		sections = append(sections, &waE2E.ListMessage_Section{
			Title: proto.String(sec.Title),
			Rows:  rows,
		})
	}

	buttonText := req.ButtonText
	if buttonText == "" {
		buttonText = "Ver opcoes"
	}

	msg := &waE2E.Message{
		ListMessage: &waE2E.ListMessage{
			Title:       proto.String(req.Title),
			Description: proto.String(req.Text),
			FooterText:  proto.String(req.Footer),
			ButtonText:  proto.String(buttonText),
			ListType:    waE2E.ListMessage_SINGLE_SELECT.Enum(),
			Sections:    sections,
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar lista: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Forward Message ---

type ForwardRequest struct {
	To        string `json:"to"`
	MessageID string `json:"messageId"`
	FromChat  string `json:"fromChat"`
}

func (h *Handler) ForwardMessage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	_, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	response.Error(w, http.StatusNotImplemented, "Encaminhamento requer cache de mensagens (nao implementado ainda)")
}

// --- Send Status/Story ---

type StatusRequest struct {
	Text       string `json:"text,omitempty"`
	URL        string `json:"url,omitempty"`
	MimeType   string `json:"mimeType,omitempty"`
	Caption    string `json:"caption,omitempty"`
	StatusType string `json:"statusType"` // text, image, video, audio
	BGColor    string `json:"bgColor,omitempty"`
	Font       int32  `json:"font,omitempty"`
}

func (h *Handler) SendStatus(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req StatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	statusJID := types.StatusBroadcastJID

	var msg *waE2E.Message

	switch req.StatusType {
	case "text":
		if req.Text == "" {
			response.BadRequest(w, "Campo 'text' e obrigatorio para status de texto")
			return
		}
		msg = &waE2E.Message{
			ExtendedTextMessage: &waE2E.ExtendedTextMessage{
				Text:           proto.String(req.Text),
				BackgroundArgb: proto.Uint32(parseHexColor(req.BGColor)),
				Font:           waE2E.ExtendedTextMessage_FontType(req.Font).Enum(),
			},
		}

	case "image":
		if req.URL == "" {
			response.BadRequest(w, "Campo 'url' e obrigatorio para status de imagem")
			return
		}
		mediaBytes, err := downloadMedia(req.URL)
		if err != nil {
			response.BadRequest(w, fmt.Sprintf("Falha ao baixar imagem: %v", err))
			return
		}
		uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaImage)
		if err != nil {
			response.Internal(w, fmt.Sprintf("Falha no upload: %v", err))
			return
		}
		mimeType := req.MimeType
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		msg = &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaBytes))),
				Mimetype:      proto.String(mimeType),
				Caption:       proto.String(req.Caption),
			},
		}

	case "video":
		if req.URL == "" {
			response.BadRequest(w, "Campo 'url' e obrigatorio para status de video")
			return
		}
		mediaBytes, err := downloadMedia(req.URL)
		if err != nil {
			response.BadRequest(w, fmt.Sprintf("Falha ao baixar video: %v", err))
			return
		}
		uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaVideo)
		if err != nil {
			response.Internal(w, fmt.Sprintf("Falha no upload: %v", err))
			return
		}
		mimeType := req.MimeType
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		msg = &waE2E.Message{
			VideoMessage: &waE2E.VideoMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaBytes))),
				Mimetype:      proto.String(mimeType),
				Caption:       proto.String(req.Caption),
			},
		}

	case "audio":
		if req.URL == "" {
			response.BadRequest(w, "Campo 'url' e obrigatorio para status de audio")
			return
		}
		mediaBytes, err := downloadMedia(req.URL)
		if err != nil {
			response.BadRequest(w, fmt.Sprintf("Falha ao baixar audio: %v", err))
			return
		}
		uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaAudio)
		if err != nil {
			response.Internal(w, fmt.Sprintf("Falha no upload: %v", err))
			return
		}
		msg = &waE2E.Message{
			AudioMessage: &waE2E.AudioMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaBytes))),
				Mimetype:      proto.String("audio/ogg; codecs=opus"),
				PTT:           proto.Bool(true),
			},
		}

	default:
		response.BadRequest(w, "statusType deve ser: text, image, video, audio")
		return
	}

	resp, err := h.sendWithDelay(client, statusJID, msg, 0, "text")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar status: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        "status@broadcast",
	})
}

// --- Send PTV (Push-To-Video / video note circular) ---

type PTVRequest struct {
	To       string `json:"to"`
	URL      string `json:"url"`
	MimeType string `json:"mimeType,omitempty"`
}

func (h *Handler) SendPTV(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	client, err := h.getClient(name)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	var req PTVRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "Corpo da requisicao invalido")
		return
	}

	if req.To == "" || req.URL == "" {
		response.BadRequest(w, "Campos 'to' e 'url' sao obrigatorios")
		return
	}

	jid, err := parseJID(req.To)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	mediaBytes, err := downloadMedia(req.URL)
	if err != nil {
		response.BadRequest(w, fmt.Sprintf("Falha ao baixar video: %v", err))
		return
	}

	uploaded, err := client.Upload(context.Background(), mediaBytes, whatsmeow.MediaVideo)
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha no upload PTV: %v", err))
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "video/mp4"
	}

	msg := &waE2E.Message{
		PtvMessage: &waE2E.VideoMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(mediaBytes))),
			Mimetype:      proto.String(mimeType),
		},
	}

	resp, err := h.sendWithDelay(client, jid, msg, 0, "video")
	if err != nil {
		response.Internal(w, fmt.Sprintf("Falha ao enviar PTV: %v", err))
		return
	}

	response.JSON(w, http.StatusOK, SendResult{
		MessageID: resp.ID,
		Timestamp: resp.Timestamp.Format(time.RFC3339),
		To:        req.To,
	})
}

// --- Utilitarios ---

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

	if strings.HasSuffix(number, "@g.us") || strings.Contains(number, "-") {
		return types.NewJID(number, types.GroupServer), nil
	}

	return types.NewJID(number, types.DefaultUserServer), nil
}

func parseHexColor(hex string) uint32 {
	if hex == "" {
		return 0xFF000000
	}
	hex = strings.TrimPrefix(hex, "#")
	var r, g, b uint32
	if len(hex) == 6 {
		fmt.Sscanf(hex, "%02x%02x%02x", &r, &g, &b)
	}
	return 0xFF000000 | (r << 16) | (g << 8) | b
}

func downloadMedia(rawURL string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	resp, err := client.Get(rawURL)
	if err != nil {
		return nil, fmt.Errorf("falha no download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download retornou status %d", resp.StatusCode)
	}

	const maxSize = 100 * 1024 * 1024 // 100MB
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSize))
	if err != nil {
		return nil, fmt.Errorf("falha ao ler midia: %w", err)
	}

	return data, nil
}
