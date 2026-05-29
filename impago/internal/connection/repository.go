package connection

import (
	"fmt"

	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Migrate() error {
	return r.db.AutoMigrate(&Connection{}, &Message{})
}

func (r *Repository) Create(conn *Connection) error {
	return r.db.Create(conn).Error
}

func (r *Repository) GetByName(name string) (*Connection, error) {
	var conn Connection
	err := r.db.Where("name = ?", name).First(&conn).Error
	if err != nil {
		return nil, fmt.Errorf("connection '%s' não encontrada", name)
	}
	return &conn, nil
}

func (r *Repository) GetByTokenHash(hash string) (*Connection, error) {
	var conn Connection
	err := r.db.Where("token_hash = ?", hash).First(&conn).Error
	if err != nil {
		return nil, err
	}
	return &conn, nil
}

func (r *Repository) GetByID(id string) (*Connection, error) {
	var conn Connection
	err := r.db.Where("id = ?", id).First(&conn).Error
	if err != nil {
		return nil, err
	}
	return &conn, nil
}

func (r *Repository) GetAll(page, perPage int) ([]Connection, int64, error) {
	var connections []Connection
	var total int64

	r.db.Model(&Connection{}).Count(&total)

	offset := (page - 1) * perPage
	err := r.db.Order("created_at DESC").Offset(offset).Limit(perPage).Find(&connections).Error
	return connections, total, err
}

func (r *Repository) GetAllConnected() ([]Connection, error) {
	var connections []Connection
	err := r.db.Where("connected = ?", true).Find(&connections).Error
	return connections, err
}

func (r *Repository) Update(conn *Connection) error {
	return r.db.Save(conn).Error
}

func (r *Repository) UpdateStatus(name string, connected bool, reason string) error {
	return r.db.Model(&Connection{}).
		Where("name = ?", name).
		Updates(map[string]interface{}{
			"connected":        connected,
			"disconnect_reason": reason,
		}).Error
}

func (r *Repository) UpdateQRCode(name, qr string) error {
	return r.db.Model(&Connection{}).
		Where("name = ?", name).
		Update("qr_code", qr).Error
}

func (r *Repository) UpdateJID(name, jid string) error {
	return r.db.Model(&Connection{}).
		Where("name = ?", name).
		Update("jid", jid).Error
}

func (r *Repository) ClearQRCode(name string) error {
	return r.db.Model(&Connection{}).
		Where("name = ?", name).
		Updates(map[string]interface{}{
			"qr_code":   "",
			"pair_code": "",
		}).Error
}

func (r *Repository) Delete(name string) error {
	var conn Connection
	err := r.db.Where("name = ?", name).First(&conn).Error
	if err != nil {
		return fmt.Errorf("connection '%s' não encontrada", name)
	}

	r.db.Where("connection_id = ?", conn.ID).Delete(&Message{})

	return r.db.Delete(&conn).Error
}

func (r *Repository) NameExists(name string) (bool, error) {
	var count int64
	err := r.db.Model(&Connection{}).Where("name = ?", name).Count(&count).Error
	return count > 0, err
}

func (r *Repository) SaveMessage(msg *Message) error {
	return r.db.Save(msg).Error
}
