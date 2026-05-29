import { io, Socket } from 'socket.io-client'

// Em produção, nginx faz proxy de /socket.io para o backend
// Em dev, VITE_API_URL aponta para localhost:3333
const SOCKET_URL = import.meta.env.VITE_API_URL || window.location.origin

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: true,
    })

    socket.on('connect_error', (err) => {
      console.warn('Socket connection error:', err.message)
    })
  }
  return socket
}

export function connectSocket() {
  const sock = getSocket()
  if (!sock.connected) {
    sock.connect()
  }
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null  // Force re-creation with fresh token on next getSocket()
  }
}

export function joinInstance(instanceId: string) {
  const sock = getSocket()
  sock.emit('join-instance', instanceId)
}

export function leaveInstance(instanceId: string) {
  const sock = getSocket()
  sock.emit('leave-instance', instanceId)
}

export function joinPipeline(pipelineId: string) {
  const sock = getSocket()
  sock.emit('join-pipeline', pipelineId)
}

export function leavePipeline(pipelineId: string) {
  const sock = getSocket()
  sock.emit('leave-pipeline', pipelineId)
}
