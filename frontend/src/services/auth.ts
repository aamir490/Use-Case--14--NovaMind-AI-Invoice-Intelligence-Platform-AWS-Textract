import { Amplify } from 'aws-amplify'
import {
  signIn,
  signUp,
  signOut,
  confirmSignUp,
  getCurrentUser as amplifyGetCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth'

export function configureAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId:       import.meta.env.VITE_COGNITO_USER_POOL_ID     || '',
        userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || '',
      },
    },
  })
}

export async function getCurrentUser() {
  const user = await amplifyGetCurrentUser()
  const session = await fetchAuthSession()
  return {
    userId: user.userId,
    email:  user.signInDetails?.loginId || '',
    name:   user.username,
    token:  session.tokens?.idToken?.toString() || '',
  }
}

export async function getIdToken(): Promise<string> {
  const session = await fetchAuthSession()
  return session.tokens?.idToken?.toString() || ''
}

export async function login(email: string, password: string) {
  try {
    return await signIn({ username: email, password })
  } catch (err: unknown) {
    // If a session already exists Amplify throws UserAlreadyAuthenticatedException.
    // Treat it as a successful sign-in — the caller will fetch the current user next.
    if (err instanceof Error && err.name === 'UserAlreadyAuthenticatedException') {
      return { isSignedIn: true, nextStep: { signInStep: 'DONE' } }
    }
    throw err
  }
}

export async function register(email: string, password: string) {
  return signUp({ username: email, password, options: { userAttributes: { email } } })
}

export async function confirmRegistration(email: string, code: string) {
  return confirmSignUp({ username: email, confirmationCode: code })
}

export async function logout() {
  return signOut()
}
