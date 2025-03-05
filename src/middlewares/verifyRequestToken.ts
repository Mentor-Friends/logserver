import TokenExpiredError from 'jsonwebtoken/lib/TokenExpiredError'
import * as jwt from 'jsonwebtoken'

/**
 * Middleware to validate if the request has the valid token
 */
const verifyRequestToken = (req: any, res: any, next: any) => {
  try {
    const authToken = req.header('authorization')
    console.log("this is the auth token", authToken);
    const token: string = authToken?.trim()?.split(' ')?.pop()
    const parts = token?.split('.')

    if (!authToken || !token || parts.length !== 3)
      return res.status(401).send({
        message: 'Token validation failed.',
      })

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET)

    if (decodedToken) {
      req.user = {
        userId: Number(decodedToken?.unique_name),
        userConcept: Number(decodedToken?.upn),
        email: decodedToken?.email,
        // token: decodedToken,
        token: token,
      }
      next()
    } else {
      return res.status(401).send({
        message: 'Token validation failed.',
      })
    }
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof jwt.NotBeforeError) {
      return res.status(401).send({
        message: 'Token Invalid!',
      })
    } else {
      console.error(err)
      return res.status(500).send({
        message: 'Internal Server Error',
      })
    }
  }
}

export default verifyRequestToken
