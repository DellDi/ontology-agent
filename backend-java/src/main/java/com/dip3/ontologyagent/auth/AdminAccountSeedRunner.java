package com.dip3.ontologyagent.auth;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
@Profile("admin-seed")
public class AdminAccountSeedRunner implements ApplicationRunner {
    private final AdminAccountService accounts;
    private final Environment environment;
    public AdminAccountSeedRunner(AdminAccountService accounts, Environment environment) { this.accounts = accounts; this.environment = environment; }
    @Override public void run(ApplicationArguments args) {
        accounts.seed(environment.getRequiredProperty("ADMIN_SEED_USERNAME"), environment.getRequiredProperty("ADMIN_SEED_PASSWORD"));
        System.out.println("Administrator account initialized; existing credentials are preserved.");
        System.exit(0);
    }
}
