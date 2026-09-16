export type AppEnvironment = "development" | "test" | "production";

export type AppConfig = {
  env: AppEnvironment;
  appName: string;
};

const APP_NAME = "PROJECT FLOW";

function readEnvName(value: string | undefined): AppEnvironment {
  if (value === undefined || value === "") {
    return "development";
  }

  if (value === "development" || value === "test" || value === "production") {
    return value;
  }

  throw new Error(
    `Invalid FLOW_APP_ENV "${value}". Expected one of: development, test, production.`,
  );
}

/**
 * Validates and returns process-level configuration.
 * Keep required variables minimal until real backends land.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const appEnv = readEnvName(env.FLOW_APP_ENV ?? env.NODE_ENV);

  return {
    env: appEnv === "test" ? "test" : appEnv,
    appName: APP_NAME,
  };
}

export function assertConfig(config: AppConfig): void {
  if (config.appName.trim().length === 0) {
    throw new Error("Invalid configuration: appName must be a non-empty string.");
  }
}
