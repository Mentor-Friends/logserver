import { CreateSessionVisit } from 'mftsccs-node'
import { createSessionCookies } from '../services/cookies/createSessionCookies'

export async function sessionTracker(req: any, res: any, next: any) {
  if (!req.cookies.SessionId) {
    await createSessionCookies(req, res)
  } else {
    const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl
    CreateSessionVisit(req.cookies.SessionId, fullUrl)
  }

  next()
}

export default sessionTracker