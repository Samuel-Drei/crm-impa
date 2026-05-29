import bcrypt from 'bcryptjs'
import { prisma } from '../../config/database.js'
import { RegisterInput, LoginInput } from './auth.schemas.js'
import { ensureCompanyRoles, getRoleId } from '../rbac/rbac.helpers.js'

/** Busca user com role + permissions + teams para montar JWT expandido */
export async function loadUserWithRbac(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      company: true,
      rbacRole: {
        include: {
          permissions: {
            include: { permission: { select: { slug: true } } },
          },
        },
      },
      teamMemberships: { select: { teamId: true } },
    },
  })
  if (!user) return null

  const permissions = user.rbacRole.permissions.map(rp => rp.permission.slug)
  const teamIds = user.teamMemberships.map(tm => tm.teamId)

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    companyId: user.companyId,
    roleId: user.roleId,
    role: user.rbacRole.slug,
    isSuperAdmin: user.isSuperAdmin,
    permissions,
    conversationScope: user.rbacRole.conversationScope,
    defaultScope: user.rbacRole.defaultScope,
    teamIds,
    company: user.company,
    isActive: user.isActive,
    password: user.password,
  }
}

export class AuthService {
  async register(data: RegisterInput) {
    // Check if public signup is enabled (like Chatwoot's check_signup_enabled)
    const signupSetting = await prisma.systemSetting.findUnique({
      where: { key: 'ENABLE_PUBLIC_SIGNUP' },
    })
    if (!signupSetting || signupSetting.value !== 'true') {
      throw new Error('Public signup is disabled')
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (existingUser) {
      throw new Error('Email already registered')
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    // 1. Criar empresa (com plano padrão)
    const defaultPlan = await prisma.plan.findFirst({ where: { isDefault: true } })
    const freePlan = defaultPlan || await prisma.plan.findUnique({ where: { slug: 'free' } })

    const company = await prisma.company.create({
      data: {
        name: data.companyName,
        email: data.email,
        plan: freePlan?.slug || 'free',
        planId: freePlan?.id || undefined,
      },
    })

    // 2. Criar roles SYSTEM para a empresa
    await ensureCompanyRoles(company.id)
    const adminRoleId = await getRoleId(company.id, 'admin')

    // 3. Criar usuário admin
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        companyId: company.id,
        roleId: adminRoleId,
      },
    })

    const fullUser = await loadUserWithRbac(user.id)

    return {
      user: {
        id: fullUser!.id,
        name: fullUser!.name,
        email: fullUser!.email,
        companyId: fullUser!.companyId,
        role: fullUser!.role,
        roleId: fullUser!.roleId,
        isSuperAdmin: fullUser!.isSuperAdmin,
        permissions: fullUser!.permissions,
        conversationScope: fullUser!.conversationScope,
        defaultScope: fullUser!.defaultScope,
        teamIds: fullUser!.teamIds,
      },
      company: {
        id: company.id,
        name: company.name,
      },
    }
  }

  async login(data: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    })

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials')
    }

    const isValidPassword = await bcrypt.compare(data.password, user.password)
    if (!isValidPassword) {
      throw new Error('Invalid credentials')
    }

    const fullUser = await loadUserWithRbac(user.id)

    return {
      user: {
        id: fullUser!.id,
        name: fullUser!.name,
        email: fullUser!.email,
        companyId: fullUser!.companyId,
        role: fullUser!.role,
        roleId: fullUser!.roleId,
        isSuperAdmin: fullUser!.isSuperAdmin,
        permissions: fullUser!.permissions,
        conversationScope: fullUser!.conversationScope,
        defaultScope: fullUser!.defaultScope,
        teamIds: fullUser!.teamIds,
      },
      company: {
        id: fullUser!.company.id,
        name: fullUser!.company.name,
      },
    }
  }

  async getProfile(userId: string) {
    const fullUser = await loadUserWithRbac(userId)
    if (!fullUser) {
      throw new Error('User not found')
    }

    return {
      id: fullUser.id,
      name: fullUser.name,
      email: fullUser.email,
      role: fullUser.role,
      roleId: fullUser.roleId,
      isSuperAdmin: fullUser.isSuperAdmin,
      permissions: fullUser.permissions,
      conversationScope: fullUser.conversationScope,
      defaultScope: fullUser.defaultScope,
      teamIds: fullUser.teamIds,
      company: {
        id: fullUser.company.id,
        name: fullUser.company.name,
        plan: fullUser.company.plan,
      },
    }
  }
}
