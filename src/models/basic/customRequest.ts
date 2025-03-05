import { Request } from 'express'

export interface RequestUser {
  userId: number
  userConcept: number
  email: string
  token: string
}

/**
 * Interface of Request which contains user (route needs verifyRequestToken middleware)
 */
export interface RequestCustom extends Request {
  user: RequestUser
}
