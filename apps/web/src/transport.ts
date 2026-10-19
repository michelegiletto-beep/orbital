export type APIConfiguration = {
  auth: "local" | "oidc";
  loginConfigured: boolean;
  model: string;
};
export type AuthenticationStatus = { authenticated: boolean };
export type APIError = { error: string };

export async function readJSON<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
