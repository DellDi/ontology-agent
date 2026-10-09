package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.RuntimeEnvironment;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** `--spring.profiles.active=local-accounts`：为本地库创建开发账号后退出（scripts/local-data accounts）。 */
@Component
@Profile("local-accounts")
public class LocalDevAccountSeedRunner implements ApplicationRunner {
  private final IdentityAccountService accounts;
  private final RuntimeEnvironment runtimeEnvironment;
  private final Environment environment;

  public LocalDevAccountSeedRunner(IdentityAccountService accounts, RuntimeEnvironment runtimeEnvironment, Environment environment) {
    this.accounts = accounts;
    this.runtimeEnvironment = runtimeEnvironment;
    this.environment = environment;
  }

  @Override public void run(ApplicationArguments args) {
    int count = LocalDevAccountSeed.seed(accounts, runtimeEnvironment, environment.getRequiredProperty("LOCAL_ACCOUNTS_PASSWORD"));
    System.out.println("Local development accounts ensured: " + count + "; existing credentials are preserved.");
    System.exit(0);
  }
}
