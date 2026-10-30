import type { AuthService } from "../auth";
import { kvStorage } from "../storage/kv-client";
import { secureStorage } from "../storage/secure-client";
import type { CredencialesAuth, RegistroUsuarioDTO, RespuestaAuth, Usuario } from "../../types";
import { apiRequest, setTokenGetter } from "./client";

// Mismas claves que el servicio mock: los tokens al almacenamiento seguro y el usuario al común.
const TOKENS_KEY = "reporte_ciudadano.tokens";
const USER_KEY = "@reporte_ciudadano:usuario";

type TokensSesion = Omit<RespuestaAuth, "user">;

/**
 * Respuesta de POST /auth/ingreso y POST /auth/registro, tal cual la define
 * `contract/api.ts` (`Sesion`). No coincide con `RespuestaAuth`, que es la forma
 * interna de la app: la traducción se hace en un solo lugar, acá.
 */
interface SesionApi {
  token: string;
  usuario: Usuario;
}

export class ApiAuthService implements AuthService {
  private currentUser: Usuario | null = null;
  private currentToken: string | null = null;

  constructor() {
    // El cliente HTTP pide el token a este servicio en cada pedido con sesión.
    setTokenGetter(() => this.getStoredToken());
  }

  private async guardarSesion(respuesta: RespuestaAuth): Promise<void> {
    const { user, ...tokens } = respuesta;
    this.currentUser = user;
    this.currentToken = respuesta.access_token;
    await Promise.all([secureStorage.setItem<TokensSesion>(TOKENS_KEY, tokens), kvStorage.setItem(USER_KEY, user)]);
  }

  private async restaurarSesion(): Promise<void> {
    if (this.currentUser && this.currentToken) {
      return;
    }
    const [tokens, user] = await Promise.all([
      secureStorage.getItem<TokensSesion>(TOKENS_KEY),
      kvStorage.getItem<Usuario>(USER_KEY),
    ]);
    if (tokens && user) {
      this.currentUser = user;
      this.currentToken = tokens.access_token;
    }
  }

  async login(credenciales: CredencialesAuth): Promise<RespuestaAuth> {
    const { datos } = await apiRequest<SesionApi>("/auth/ingreso", {
      method: "POST",
      auth: false,
      // `IngresoDto` pide `contrasena`; `password` lo rechaza el ValidationPipe global.
      body: { email: credenciales.email.trim(), contrasena: credenciales.password },
    });
    const respuesta: RespuestaAuth = { user: datos.usuario, access_token: datos.token, token_type: "Bearer" };
    await this.guardarSesion(respuesta);
    return respuesta;
  }

  async register(datos: RegistroUsuarioDTO): Promise<RespuestaAuth> {
    const { datos: sesion } = await apiRequest<SesionApi>("/auth/registro", {
      method: "POST",
      auth: false,
      // `RegistroDto` acepta sólo nombre, email, contrasena y telefono.
      body: {
        nombre: datos.nombre.trim(),
        email: datos.email.trim(),
        contrasena: datos.password,
        telefono: datos.telefono?.trim() || null,
      },
    });
    const respuesta: RespuestaAuth = { user: sesion.usuario, access_token: sesion.token, token_type: "Bearer" };
    await this.guardarSesion(respuesta);
    return respuesta;
  }

  async logout(): Promise<void> {
    this.currentUser = null;
    this.currentToken = null;
    await Promise.all([secureStorage.removeItem(TOKENS_KEY), kvStorage.removeItem(USER_KEY)]);
  }

  async getCurrentUser(): Promise<Usuario | null> {
    await this.restaurarSesion();
    return this.currentUser;
  }

  async getStoredToken(): Promise<string | null> {
    await this.restaurarSesion();
    return this.currentToken;
  }
}
