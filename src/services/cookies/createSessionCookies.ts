import { CreateSession, SessionData } from 'mftsccs-node'

export async function createSessionCookies(req: any, res: any) {
  try {
    const session = new SessionData()
    session.port = req.socket.remotePort.toString()
    session.remote_address = req.ip.toString()
    session.server_port = req.socket.localPort.toString()
    session.server_name = req.headers.host.toString()
    req.sessionData = session
    const newSession = await CreateSession(session)
    res.cookie('SessionId', newSession?.data || 999, {
      sameSite: 'none',
      secure: true,
    })
  } catch (ex) {
    console.error('Error while getting session in cookies', ex)
  }
}

export async function createSessionCookiesFromAuth(
  req: any,
  res: any,
  userId: string,
  email: string,
) {
  try {
    const session = new SessionData()
    session.port = req.socket.remotePort.toString()
    session.remote_address = req.ip.toString()
    session.server_port = req.socket.localPort.toString()
    session.server_name = req.headers.host.toString()
    session.userId = userId
    session.email = email
    req.sessionData = session
    const newSession = await CreateSession(session)
    res.cookie('SessionId', newSession?.data || 999, {
      sameSite: 'none',
      secure: true,
    })
  } catch (ex) {
    console.error('Error while getting session in cookies', ex)
  }
}
