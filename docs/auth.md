# Authentification

Klasr normalise toute adresse e-mail (`trim` puis minuscules) avant recherche ou création. L’inscription locale valide les entrées côté API, stocke uniquement un hash bcrypt (coût 12) et crée l’utilisateur, son organisation et son adhésion propriétaire dans une transaction Prisma.

## Règle de liaison sûre

Tout fournisseur externe, connu ou futur, est refusé par défaut : la création ou la réutilisation exige qu’il ait explicitement attesté `email_verified: true`. Une adresse non vérifiée ou le seul identifiant de compte fournisseur ne suffit jamais.

Google est accepté uniquement avec `email_verified: true`. Les seuls adaptateurs internes considérés comme vérifiés sont les identifiants existants `local-mvp` et `google-service-account-acceptance`; le type générique `credentials` ne donne aucune confiance à un futur fournisseur. Microsoft/Azure ne fournit pas ici de signal de propriété équivalent : `preferred_username`, `email` et tout repli mutable sont refusés. Son choix reste donc visible mais désactivé jusqu’à l’ajout d’une vérification ou liaison spécifique au fournisseur.

Même avec cette attestation, un compte portant déjà un hash de mot de passe n’est jamais lié automatiquement : l’utilisateur doit employer sa connexion locale. La réutilisation automatique est limitée à un compte de même adresse créé par OAuth et dépourvu de mot de passe.

La création initiale imbrique une création stricte de `User` dans celle de l’organisation. Ainsi, un conflit `User.email` (`P2002`) annule toute la transaction, organisation et adhésion comprises ; le service relit ensuite l’identité gagnante et refuse si elle est locale. Cette garantie est limitée à ce chemin d’auto-onboarding et ne prétend pas que `connectOrCreate` empêcherait à lui seul une seconde organisation.

Les mots de passe, hashes, jetons et secrets ne sont jamais journalisés. Les sessions restent des JWT NextAuth portant l’utilisateur, l’adhésion et l’organisation issus du serveur.

## Ajout explicite d’un mot de passe local

Un propriétaire déjà connecté par Google peut ajouter une connexion locale depuis « Paramètres ». Le navigateur ne choisit ni utilisateur, ni organisation, ni adresse : le BFF dérive l’utilisateur, l’adhésion et l’organisation de la session authentifiée, impose une origine identique, puis l’API revérifie exactement cette identité.

L’opération est réservée à une identité sans mot de passe, avec une adhésion propriétaire et une connexion Google réelle du même utilisateur et du même tenant. Les adaptateurs internes d’acceptation, Microsoft, les fournisseurs futurs, les identités incohérentes et les comptes déjà locaux sont refusés. L’écriture Prisma conditionnelle exige encore toutes ces propriétés et `passwordHash = null` : en cas de concurrence, une seule requête écrit le hash bcrypt et les autres reçoivent un conflit sans remplacement.

## Limite de pré-inscription et récupération

Le refus de toute inscription locale lorsqu’une adresse existe déjà empêche le pré-hijack, mais permet un déni de service ciblé : un tiers peut pré-enregistrer l’adresse d’une victime avant elle. Une vérification d’adresse avant activation, puis un parcours de récupération et de contestation de propriété, restent au backlog. En attendant, aucune fusion automatique ne contourne ce refus.

## Limite de débit acceptée pour cette livraison

Les endpoints internes `POST /api/v1/auth/register` et `POST /api/v1/auth/credentials` ne disposent pas encore d’un contrôle durable contre les tentatives répétées : une fuite du secret inter-service ou un trafic automatisé via le BFF peut donc permettre le bourrage d’identifiants, la recherche de mots de passe ou le déni de service par créations répétées. La décision explicite est de livrer cette version avec cette limite connue, plutôt que d’ajouter un compteur mémoire par processus qui serait contournable au redémarrage ou avec plusieurs instances.

Le backlog exige un contrôle partagé et durable combinant l’adresse IP issue d’une chaîne de proxy de confiance et l’adresse e-mail normalisée (`trim` puis minuscules), avec fenêtres, backoff et expiration. En attendant, l’exposition doit rester limitée au BFF same-origin, le secret inter-service doit être restreint et renouvelable, et le reverse proxy doit appliquer ses propres plafonds et alertes sur ces deux routes. L’exploitation publique sans cette mitigation opérationnelle n’est pas approuvée.
