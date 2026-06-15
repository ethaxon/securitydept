import { SecuritydeptInjectionToken } from "@securitydept/client";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import { type TokenSetClientRegistry } from "../core/client-registry";
import { type TokenSetClientRegistryEntry } from "./types";

export const TOKEN_SET_CLIENT_REGISTRY_ENTRIES = new SecuritydeptInjectionToken<
	readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[]
>("TOKEN_SET_CLIENT_REGISTRY_ENTRIES");

export const TOKEN_SET_CLIENT_REGISTRY = new SecuritydeptInjectionToken<
	TokenSetClientRegistry<BaseOidcModeClient>
>("TOKEN_SET_CLIENT_REGISTRY");
