package connection

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Connection struct {
	ID               string         `json:"id" gorm:"type:uuid;primaryKey"`
	Name             string         `json:"name" gorm:"type:varchar(100);uniqueIndex;not null"`
	TokenHash        string         `json:"-" gorm:"type:varchar(255);uniqueIndex;not null"`
	TokenHint        string         `json:"tokenHint,omitempty" gorm:"type:varchar(12)"`
	WebhookURL       string         `json:"webhookUrl,omitempty" gorm:"type:text"`
	JID              string         `json:"jid,omitempty" gorm:"type:varchar(50)"`
	Connected        bool           `json:"connected" gorm:"default:false"`
	DisconnectReason string         `json:"disconnectReason,omitempty" gorm:"type:text"`
	QRCode           string         `json:"-" gorm:"type:text"`
	PairCode         string         `json:"-" gorm:"type:varchar(20)"`
	Events           string         `json:"events,omitempty" gorm:"type:text"`
	AlwaysOnline     bool           `json:"alwaysOnline" gorm:"default:false"`
	RejectCalls      bool           `json:"rejectCalls" gorm:"default:false"`
	RejectCallMsg    string         `json:"rejectCallMsg,omitempty" gorm:"type:varchar(255)"`
	ReadMessages     bool           `json:"readMessages" gorm:"default:false"`
	IgnoreGroups     bool           `json:"ignoreGroups" gorm:"default:false"`
	IgnoreStatus     bool           `json:"ignoreStatus" gorm:"default:false"`
	ProxyHost        string         `json:"-" gorm:"type:varchar(255)"`
	ProxyPort        string         `json:"-" gorm:"type:varchar(10)"`
	ProxyUser        string         `json:"-" gorm:"type:varchar(100)"`
	ProxyPass        string         `json:"-" gorm:"type:varchar(100)"`
	CreatedAt        time.Time      `json:"createdAt" gorm:"autoCreateTime"`
	UpdatedAt        time.Time      `json:"updatedAt" gorm:"autoUpdateTime"`
	DeletedAt        gorm.DeletedAt `json:"-" gorm:"index"`
}

func (c *Connection) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	return nil
}

type ConnectionPublic struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	TokenHint    string    `json:"tokenHint,omitempty"`
	WebhookURL   string    `json:"webhookUrl,omitempty"`
	JID          string    `json:"jid,omitempty"`
	Connected    bool      `json:"connected"`
	Events       string    `json:"events,omitempty"`
	AlwaysOnline bool      `json:"alwaysOnline"`
	RejectCalls  bool      `json:"rejectCalls"`
	ReadMessages bool      `json:"readMessages"`
	IgnoreGroups bool      `json:"ignoreGroups"`
	IgnoreStatus bool      `json:"ignoreStatus"`
	HasProxy     bool      `json:"hasProxy"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (c *Connection) ToPublic() ConnectionPublic {
	return ConnectionPublic{
		ID:           c.ID,
		Name:         c.Name,
		TokenHint:    c.TokenHint,
		WebhookURL:   c.WebhookURL,
		JID:          c.JID,
		Connected:    c.Connected,
		Events:       c.Events,
		AlwaysOnline: c.AlwaysOnline,
		RejectCalls:  c.RejectCalls,
		ReadMessages: c.ReadMessages,
		IgnoreGroups: c.IgnoreGroups,
		IgnoreStatus: c.IgnoreStatus,
		HasProxy:     c.ProxyHost != "",
		CreatedAt:    c.CreatedAt,
	}
}

type Message struct {
	ID           string    `json:"id" gorm:"type:uuid;primaryKey"`
	ConnectionID string    `json:"connectionId" gorm:"type:uuid;index"`
	MessageID    string    `json:"messageId" gorm:"type:varchar(100);uniqueIndex;not null"`
	Timestamp    time.Time `json:"timestamp"`
	Status       string    `json:"status" gorm:"type:varchar(20)"`
	Direction    string    `json:"direction" gorm:"type:varchar(10)"`
	ChatJID      string    `json:"chatJid" gorm:"type:varchar(50)"`
	SenderJID    string    `json:"senderJid" gorm:"type:varchar(50)"`
	Content      string    `json:"content,omitempty" gorm:"type:text"`
}

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return nil
}
