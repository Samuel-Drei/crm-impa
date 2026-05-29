package engine

import (
	"context"
	"fmt"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

func (s *Session) handleEvent(rawEvt interface{}) {
	switch evt := rawEvt.(type) {
	case *events.Connected:
		s.onConnected()

	case *events.Disconnected:
		s.onDisconnected()

	case *events.LoggedOut:
		s.onLoggedOut(evt)

	case *events.PairSuccess:
		s.onPairSuccess(evt)

	case *events.Message:
		s.onMessage(evt)

	case *events.Receipt:
		s.onReceipt(evt)

	case *events.Presence:
		s.onPresence(evt)

	case *events.CallOffer:
		s.onCallOffer(evt)

	case *events.HistorySync:
		s.log.Debug().Msg("Sincronização de histórico recebida")

	case *events.PushNameSetting:
		s.log.Info().Str("pushName", evt.Action.GetName()).Msg("PushName atualizado")
	}
}

func (s *Session) onConnected() {
	s.log.Info().Msg("WhatsApp conectado")

	jid := ""
	if s.client.Store.ID != nil {
		jid = s.client.Store.ID.String()
	}

	if s.manager.callbacks != nil {
		if err := s.manager.callbacks.OnConnected(s.sessionConfig.Name, jid); err != nil {
			s.log.Warn().Err(err).Msg("Falha no callback OnConnected")
		}
	}

	if s.sessionConfig.AlwaysOnline {
		s.client.SendPresence(context.Background(), types.PresenceAvailable)
	}

	s.dispatchEvent("connection.connected", map[string]string{
		"jid": jid,
	})
}

func (s *Session) onDisconnected() {
	s.log.Warn().Msg("WhatsApp desconectado")
	s.notifyDisconnected("desconectado pelo servidor")
	s.dispatchEvent("connection.disconnected", nil)
}

func (s *Session) onLoggedOut(evt *events.LoggedOut) {
	reason := fmt.Sprintf("logout: %v", evt.Reason)
	s.log.Warn().Int32("reason", int32(evt.Reason)).Msg("Logout do WhatsApp")

	if s.manager.callbacks != nil {
		if err := s.manager.callbacks.OnLoggedOut(s.sessionConfig.Name, reason); err != nil {
			s.log.Warn().Err(err).Msg("Falha no callback OnLoggedOut")
		}
	}

	s.dispatchEvent("connection.loggedout", map[string]interface{}{
		"reason": reason,
	})
}

func (s *Session) onPairSuccess(evt *events.PairSuccess) {
	jid := evt.ID.String()
	s.log.Info().Str("jid", jid).Msg("Pareamento bem-sucedido")

	s.mu.Lock()
	s.currentQR = ""
	s.currentCode = ""
	s.mu.Unlock()

	if s.manager.callbacks != nil {
		if err := s.manager.callbacks.OnPaired(s.sessionConfig.Name, jid); err != nil {
			s.log.Warn().Err(err).Msg("Falha no callback OnPaired")
		}
	}

	s.dispatchEvent("connection.paired", map[string]string{
		"jid": jid,
	})
}

func (s *Session) onMessage(evt *events.Message) {
	if s.sessionConfig.IgnoreGroups && evt.Info.IsGroup {
		return
	}

	if s.sessionConfig.IgnoreStatus && evt.Info.Chat.String() == "status@broadcast" {
		return
	}

	msgData := MessageEvent{
		MessageID:   evt.Info.ID,
		ChatJID:     evt.Info.Chat.String(),
		SenderJID:   evt.Info.Sender.String(),
		IsGroup:     evt.Info.IsGroup,
		IsFromMe:    evt.Info.IsFromMe,
		Timestamp:   evt.Info.Timestamp.Format(time.RFC3339),
		PushName:    evt.Info.PushName,
	}

	if evt.Message.GetConversation() != "" {
		msgData.Type = "text"
		msgData.Text = evt.Message.GetConversation()
	} else if evt.Message.GetExtendedTextMessage() != nil {
		msgData.Type = "text"
		msgData.Text = evt.Message.GetExtendedTextMessage().GetText()
	} else if evt.Message.GetImageMessage() != nil {
		msgData.Type = "image"
		msgData.MimeType = evt.Message.GetImageMessage().GetMimetype()
		msgData.Caption = evt.Message.GetImageMessage().GetCaption()
	} else if evt.Message.GetVideoMessage() != nil {
		msgData.Type = "video"
		msgData.MimeType = evt.Message.GetVideoMessage().GetMimetype()
		msgData.Caption = evt.Message.GetVideoMessage().GetCaption()
	} else if evt.Message.GetAudioMessage() != nil {
		msgData.Type = "audio"
		msgData.MimeType = evt.Message.GetAudioMessage().GetMimetype()
		msgData.IsPTT = evt.Message.GetAudioMessage().GetPTT()
	} else if evt.Message.GetDocumentMessage() != nil {
		msgData.Type = "document"
		msgData.MimeType = evt.Message.GetDocumentMessage().GetMimetype()
		msgData.FileName = evt.Message.GetDocumentMessage().GetFileName()
	} else if evt.Message.GetStickerMessage() != nil {
		msgData.Type = "sticker"
		msgData.MimeType = evt.Message.GetStickerMessage().GetMimetype()
	} else if evt.Message.GetContactMessage() != nil {
		msgData.Type = "contact"
		msgData.VCard = evt.Message.GetContactMessage().GetVcard()
	} else if evt.Message.GetLocationMessage() != nil {
		msgData.Type = "location"
		loc := evt.Message.GetLocationMessage()
		msgData.Latitude = loc.GetDegreesLatitude()
		msgData.Longitude = loc.GetDegreesLongitude()
	} else if evt.Message.GetReactionMessage() != nil {
		msgData.Type = "reaction"
		msgData.Text = evt.Message.GetReactionMessage().GetText()
	} else {
		msgData.Type = "unknown"
	}

	if s.sessionConfig.ReadMessages && !evt.Info.IsFromMe {
		// Anti-ban: delay natural antes de marcar como lida (evita padrão de bot)
		time.Sleep(1 * time.Second)
		s.client.MarkRead(context.Background(), []types.MessageID{evt.Info.ID}, evt.Info.Timestamp, evt.Info.Chat, evt.Info.Sender)
	}

	s.dispatchEvent("message.received", msgData)
}

func (s *Session) onReceipt(evt *events.Receipt) {
	receiptType := "delivery"
	switch evt.Type {
	case types.ReceiptTypeRead:
		receiptType = "read"
	case types.ReceiptTypeDelivered:
		receiptType = "delivered"
	case types.ReceiptTypePlayed:
		receiptType = "played"
	}

	ids := make([]string, len(evt.MessageIDs))
	for i, id := range evt.MessageIDs {
		ids[i] = string(id)
	}

	s.dispatchEvent("message.receipt", map[string]interface{}{
		"type":       receiptType,
		"chatJid":    evt.Chat.String(),
		"senderJid":  evt.Sender.String(),
		"messageIds": ids,
		"timestamp":  evt.Timestamp.Format(time.RFC3339),
	})
}

func (s *Session) onPresence(evt *events.Presence) {
	s.dispatchEvent("contact.presence", map[string]interface{}{
		"jid":          evt.From.String(),
		"available":    evt.Unavailable == false,
		"lastSeen":     evt.LastSeen.Format(time.RFC3339),
	})
}

func (s *Session) onCallOffer(evt *events.CallOffer) {
	s.log.Info().
		Str("from", evt.CallCreator.String()).
		Str("callId", evt.CallID).
		Msg("Chamada recebida")

	if s.sessionConfig.RejectCalls {
		s.client.RejectCall(context.Background(), evt.CallCreator, evt.CallID)
		s.log.Info().Msg("Chamada rejeitada automaticamente")
	}

	s.dispatchEvent("call.received", map[string]interface{}{
		"callId":    evt.CallID,
		"from":      evt.CallCreator.String(),
		"timestamp": evt.Timestamp.Format(time.RFC3339),
		"rejected":  s.sessionConfig.RejectCalls,
	})
}

type MessageEvent struct {
	MessageID types.MessageID `json:"messageId"`
	ChatJID   string          `json:"chatJid"`
	SenderJID string          `json:"senderJid"`
	IsGroup   bool            `json:"isGroup"`
	IsFromMe  bool            `json:"isFromMe"`
	Timestamp string          `json:"timestamp"`
	PushName  string          `json:"pushName"`
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	Caption   string          `json:"caption,omitempty"`
	MimeType  string          `json:"mimeType,omitempty"`
	FileName  string          `json:"fileName,omitempty"`
	IsPTT     bool            `json:"isPtt,omitempty"`
	VCard     string          `json:"vcard,omitempty"`
	Latitude  float64         `json:"latitude,omitempty"`
	Longitude float64         `json:"longitude,omitempty"`
}
