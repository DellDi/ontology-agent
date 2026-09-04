package com.dip3.ontologyagent.architecture;

import com.tngtech.archunit.core.domain.Dependency;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.dip3.ontologyagent", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureRulesTest {
    private static final String ROOT_PACKAGE = "com.dip3.ontologyagent.";

    @ArchTest
    static final ArchRule DOMAIN_DOES_NOT_DEPEND_ON_FRAMEWORKS = noClasses()
            .that().resideInAPackage("..internal.domain..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "org.springframework..",
                    "com.baomidou..",
                    "jakarta.servlet..",
                    "javax.servlet..",
                    "org.neo4j..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule DOMAIN_DOES_NOT_DEPEND_ON_APPLICATION_OR_ADAPTERS = noClasses()
            .that().resideInAPackage("..internal.domain..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "..internal.application..",
                    "..internal.adapter..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule APPLICATION_DOES_NOT_DEPEND_ON_ADAPTERS = noClasses()
            .that().resideInAPackage("..internal.application..")
            .should().dependOnClassesThat().resideInAnyPackage("..internal.adapter..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule INBOUND_ADAPTER_DOES_NOT_DEPEND_ON_PERSISTENCE_ADAPTER = noClasses()
            .that().resideInAPackage("..internal.adapter.in..")
            .should().dependOnClassesThat().resideInAnyPackage("..internal.adapter.out.persistence..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule PERSISTENCE_ENTITIES_STAY_IN_PERSISTENCE_ADAPTER = classes()
            .that().resideInAPackage("..internal..")
            .and().haveSimpleNameEndingWith("PersistenceEntity")
            .should().resideInAPackage("..internal.adapter.out.persistence..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule FEATURE_INTERNALS_ARE_PRIVATE_TO_THEIR_FEATURE = classes()
            .that().resideInAPackage("..internal..")
            .should(onlyBeAccessedByTheSameFeature())
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule PROPERTY_DOES_NOT_DEPEND_ON_EASYV = noClasses()
            .that().resideInAPackage("..property..")
            .should().dependOnClassesThat().resideInAnyPackage("..easyv..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule EASYV_DOES_NOT_DEPEND_ON_PROPERTY = noClasses()
            .that().resideInAPackage("..easyv..")
            .should().dependOnClassesThat().resideInAnyPackage("..property..")
            .allowEmptyShould(true);

    @ArchTest
    static final ArchRule SPRING_AI_STAYS_IN_LLM_ADAPTER = noClasses()
            .that().resideOutsideOfPackage("..internal.adapter.out.llm..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework.ai..")
            .allowEmptyShould(true);

    private static ArchCondition<JavaClass> onlyBeAccessedByTheSameFeature() {
        return new ArchCondition<>("only be accessed by classes in the same feature") {
            @Override
            public void check(JavaClass target, ConditionEvents events) {
                String targetFeature = featureOf(target);
                for (Dependency dependency : target.getDirectDependenciesToSelf()) {
                    JavaClass origin = dependency.getOriginClass();
                    if (origin.getPackageName().startsWith(ROOT_PACKAGE)
                            && !targetFeature.equals(featureOf(origin))) {
                        events.add(SimpleConditionEvent.violated(dependency,
                                origin.getName() + " accesses internal type " + target.getName()));
                    }
                }
            }
        };
    }

    private static String featureOf(JavaClass javaClass) {
        String packageName = javaClass.getPackageName();
        if (!packageName.startsWith(ROOT_PACKAGE)) {
            return packageName;
        }
        String relative = packageName.substring(ROOT_PACKAGE.length());
        int separator = relative.indexOf('.');
        return separator < 0 ? relative : relative.substring(0, separator);
    }
}
