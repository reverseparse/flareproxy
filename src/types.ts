export type ProxyMode = "hls" | "dash" | "stream";
export interface ProxyState { u:string; h?:Record<string,string>; m?:ProxyMode; e?:number; }
export interface Env { PROXY_SECRET:string; ALLOWED_HOSTS?:string; }
