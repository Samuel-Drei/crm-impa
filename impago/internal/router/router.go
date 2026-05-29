package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"impago/internal/call"
	"impago/internal/chat"
	"impago/internal/community"
	"impago/internal/config"
	"impago/internal/connection"
	"impago/internal/group"
	"impago/internal/label"
	"impago/internal/messaging"
	"impago/internal/middleware"
	"impago/internal/newsletter"
	"impago/internal/user"
)

func New(
	cfg *config.Config,
	connHandler *connection.Handler,
	msgHandler *messaging.Handler,
	chatHandler *chat.Handler,
	groupHandler *group.Handler,
	userHandler *user.Handler,
	labelHandler *label.Handler,
	communityHandler *community.Handler,
	newsletterHandler *newsletter.Handler,
	callHandler *call.Handler,
	connRepo *connection.Repository,
) http.Handler {
	r := chi.NewRouter()

	// Middlewares globais
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Compress(5))
	r.Use(middleware.RequestID)
	r.Use(middleware.CORS(cfg.CORSOrigins))

	// Health check (sem auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"impago"}`))
	})

	// API v1
	r.Route("/v1", func(r chi.Router) {

		// --- Rotas administrativas (Master Key) ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.MasterKeyAuth(cfg.MasterKey))

			// Connections CRUD
			r.Post("/connections", connHandler.Create)
			r.Get("/connections", connHandler.List)
			r.Get("/connections/{name}", connHandler.Get)
			r.Patch("/connections/{name}", connHandler.Update)
			r.Delete("/connections/{name}", connHandler.Delete)

			// Sessão
			r.Post("/connections/{name}/session/start", connHandler.StartSession)
			r.Post("/connections/{name}/session/stop", connHandler.StopSession)
			r.Post("/connections/{name}/session/restart", connHandler.RestartSession)
			r.Post("/connections/{name}/session/logout", connHandler.LogoutSession)
			r.Get("/connections/{name}/session/status", connHandler.GetStatus)
			r.Get("/connections/{name}/session/qrcode", connHandler.GetQRCode)
			r.Post("/connections/{name}/session/pair", connHandler.PairPhone)

			// === MENSAGENS ===
			r.Post("/connections/{name}/messages/text", msgHandler.SendText)
			r.Post("/connections/{name}/messages/image", msgHandler.SendImage)
			r.Post("/connections/{name}/messages/audio", msgHandler.SendAudio)
			r.Post("/connections/{name}/messages/video", msgHandler.SendVideo)
			r.Post("/connections/{name}/messages/document", msgHandler.SendDocument)
			r.Post("/connections/{name}/messages/location", msgHandler.SendLocation)
			r.Post("/connections/{name}/messages/contact", msgHandler.SendContact)
			r.Post("/connections/{name}/messages/reaction", msgHandler.SendReaction)
			r.Post("/connections/{name}/messages/poll", msgHandler.SendPoll)
			r.Post("/connections/{name}/messages/sticker", msgHandler.SendSticker)
			r.Post("/connections/{name}/messages/link", msgHandler.SendLink)
			r.Post("/connections/{name}/messages/button", msgHandler.SendButton)
			r.Post("/connections/{name}/messages/list", msgHandler.SendList)
			r.Post("/connections/{name}/messages/forward", msgHandler.ForwardMessage)
			r.Post("/connections/{name}/messages/status", msgHandler.SendStatus)
			r.Post("/connections/{name}/messages/ptv", msgHandler.SendPTV)

			// === CHAT ===
			r.Post("/connections/{name}/chat/presence", chatHandler.ChatPresence)
			r.Post("/connections/{name}/chat/mark-read", chatHandler.MarkRead)
			r.Post("/connections/{name}/chat/mark-unread", chatHandler.MarkChatUnread)
			r.Post("/connections/{name}/chat/download-media", chatHandler.DownloadMedia)
			r.Post("/connections/{name}/chat/delete-message", chatHandler.DeleteMessage)
			r.Post("/connections/{name}/chat/edit-message", chatHandler.EditMessage)
			r.Post("/connections/{name}/chat/pin", chatHandler.PinChat)
			r.Post("/connections/{name}/chat/unpin", chatHandler.UnpinChat)
			r.Post("/connections/{name}/chat/archive", chatHandler.ArchiveChat)
			r.Post("/connections/{name}/chat/unarchive", chatHandler.UnarchiveChat)
			r.Post("/connections/{name}/chat/mute", chatHandler.MuteChat)
			r.Post("/connections/{name}/chat/unmute", chatHandler.UnmuteChat)
			r.Post("/connections/{name}/chat/history-sync", chatHandler.HistorySync)

			// === USER / PROFILE ===
			r.Post("/connections/{name}/user/check", userHandler.CheckUser)
			r.Post("/connections/{name}/user/info", userHandler.GetUserInfo)
			r.Post("/connections/{name}/user/avatar", userHandler.GetAvatar)
			r.Get("/connections/{name}/user/contacts", userHandler.GetContacts)
			r.Post("/connections/{name}/user/profile/picture", userHandler.SetProfilePicture)
			r.Delete("/connections/{name}/user/profile/picture", userHandler.RemoveProfilePicture)
			r.Post("/connections/{name}/user/profile/name", userHandler.SetProfileName)
			r.Post("/connections/{name}/user/profile/status", userHandler.SetProfileStatus)
			r.Get("/connections/{name}/user/privacy", userHandler.GetPrivacy)
			r.Post("/connections/{name}/user/privacy", userHandler.SetPrivacy)
			r.Post("/connections/{name}/user/block", userHandler.BlockContact)
			r.Post("/connections/{name}/user/unblock", userHandler.UnblockContact)
			r.Get("/connections/{name}/user/blocklist", userHandler.GetBlockList)
			r.Post("/connections/{name}/user/business-profile", userHandler.FetchBusinessProfile)

			// === LABEL ===
			r.Get("/connections/{name}/label", labelHandler.GetLabels)
			r.Get("/connections/{name}/label/{labelId}", labelHandler.GetLabelByID)
			r.Get("/connections/{name}/label/{labelId}/chats", labelHandler.GetLabeledChats)
			r.Post("/connections/{name}/label/chat", labelHandler.ChatLabel)
			r.Delete("/connections/{name}/label/chat", labelHandler.ChatUnlabel)
			r.Post("/connections/{name}/label/message", labelHandler.MessageLabel)
			r.Delete("/connections/{name}/label/message", labelHandler.MessageUnlabel)
			r.Put("/connections/{name}/label", labelHandler.EditLabel)

			// === GROUP ===
			r.Get("/connections/{name}/group", groupHandler.ListGroups)
			r.Post("/connections/{name}/group/create", groupHandler.CreateGroup)
			r.Post("/connections/{name}/group/info", groupHandler.GetGroupInfo)
			r.Get("/connections/{name}/group/invite-link/{groupJid}", groupHandler.GetInviteLink)
			r.Post("/connections/{name}/group/revoke-invite", groupHandler.RevokeInviteLink)
			r.Post("/connections/{name}/group/invite-info", groupHandler.InviteInfo)
			r.Post("/connections/{name}/group/join", groupHandler.JoinGroup)
			r.Post("/connections/{name}/group/leave", groupHandler.LeaveGroup)
			r.Post("/connections/{name}/group/photo", groupHandler.SetGroupPhoto)
			r.Post("/connections/{name}/group/name", groupHandler.SetGroupName)
			r.Post("/connections/{name}/group/description", groupHandler.SetGroupDescription)
			r.Post("/connections/{name}/group/participant", groupHandler.UpdateParticipant)
			r.Post("/connections/{name}/group/settings", groupHandler.UpdateGroupSettings)
			r.Post("/connections/{name}/group/requests", groupHandler.GetGroupRequests)
			r.Post("/connections/{name}/group/requests/action", groupHandler.ActionGroupRequests)
			r.Post("/connections/{name}/group/ephemeral", groupHandler.ToggleEphemeral)

			// === COMMUNITY ===
			r.Post("/connections/{name}/community/create", communityHandler.CreateCommunity)
			r.Post("/connections/{name}/community/add-group", communityHandler.CommunityAddGroup)
			r.Post("/connections/{name}/community/remove-group", communityHandler.CommunityRemoveGroup)
			r.Post("/connections/{name}/community/deactivate", communityHandler.DeactivateCommunity)
			r.Get("/connections/{name}/community/{communityJid}", communityHandler.GetCommunityInfo)

			// === NEWSLETTER ===
			r.Post("/connections/{name}/newsletter/create", newsletterHandler.CreateNewsletter)
			r.Get("/connections/{name}/newsletter", newsletterHandler.ListNewsletters)
			r.Post("/connections/{name}/newsletter/info", newsletterHandler.GetNewsletter)
			r.Post("/connections/{name}/newsletter/invite", newsletterHandler.GetNewsletterByInvite)
			r.Post("/connections/{name}/newsletter/follow", newsletterHandler.FollowNewsletter)
			r.Post("/connections/{name}/newsletter/unfollow", newsletterHandler.UnfollowNewsletter)
			r.Post("/connections/{name}/newsletter/mute", newsletterHandler.MuteNewsletter)
			r.Post("/connections/{name}/newsletter/unmute", newsletterHandler.UnmuteNewsletter)
			r.Post("/connections/{name}/newsletter/messages", newsletterHandler.GetNewsletterMessages)
			r.Post("/connections/{name}/newsletter/admin-invite", newsletterHandler.SendAdminInvite)

			// === CALL ===
			r.Post("/connections/{name}/call/reject", callHandler.RejectCall)
			r.Post("/connections/{name}/call/offer", callHandler.OfferCall)
		})
	})

	return r
}
