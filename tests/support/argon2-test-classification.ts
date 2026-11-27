import type { DerivationClassification } from './test-derivation';

/*
 * E1.07-PD65-T4-C1 (D-246) — classificação dos testes com derivações Argon2id (inventário na
 * PD65-T4 e em `docs/tasks/E1.07-PD65-T4-C1.md`). Três classes:
 *
 * - criptografia real obrigatória: o objecto do teste é a própria derivação (algoritmo, parâmetros,
 *   salt, custo, contagem de derivações, *rehash*). Nunca constam de `deterministicAllowed`;
 * - integração de segurança real obrigatória: percursos críticos de ponta a ponta (recuperação R1,
 *   autenticação, âncora, verificação e revogação de sessões). As sentinelas `argon2idRequired`
 *   provam, em cada execução, que esses percursos continuam a derivar com Argon2id real;
 * - derivação determinística de teste permitida: o objecto do teste não depende da derivação
 *   (limites, relógios, concorrência de estado, contagens, isolamento por estado). Só estes podem
 *   chamar `useDeterministic()`.
 *
 * Os testes não listados ficam no Argon2id real (omissão). Alterar estas listas é uma alteração da
 * classificação aprovada e tem de ser revista.
 */

export const LOCAL_SESSIONS_DERIVATION: DerivationClassification = Object.freeze({
  argon2idRequired: Object.freeze(['[S02]', '[S06]', '[S11]', '[S28]', '[S35]', '[S43]']),
  deterministicAllowed: Object.freeze(['[S15]', '[S30]', '[S31]', '[S47]', '[S47b]', '[S47c]', '[S47d]', '[S48]', '[S48b]']),
});

export const LOCAL_AUTHENTICATION_DERIVATION: DerivationClassification = Object.freeze({
  argon2idRequired: Object.freeze([
    'authenticates an ACTIVE identity with a valid credential and returns a minimal result',
    'refuses unknown usernames and wrong passwords',
    'keeps credentials and the installation state after restarting the service',
  ]),
  deterministicAllowed: Object.freeze([
    'locks a username temporarily after five failures and doubles the lock on each new failure',
    'accepts the correct password after the lock expires and resets the counter',
    'keeps the throttle state across service restarts',
    'cannot be bypassed with concurrent attempts',
    'limits unknown usernames in the same way, storing only SHA-256 keys',
    'stays bounded when the system clock moves backwards or forwards',
  ]),
});

export const IDENTITY_GATE_DERIVATION: DerivationClassification = Object.freeze({
  argon2idRequired: Object.freeze(['[G06]', '[G17]', '[G18]']),
  deterministicAllowed: Object.freeze(['[G21]', '[G22]']),
});

export const INSTALLATION_RECOVERY_DERIVATION: DerivationClassification = Object.freeze({
  argon2idRequired: Object.freeze(['[R-F02]', '[R-F04]', '[R-F07]', '[R-S08]', '[R-F10]', '[R-S15]']),
  deterministicAllowed: Object.freeze([
    '[R-F04b]',
    '[R-F05]',
    '[R-F08]',
    '[R-F09]',
    '[R-F11]',
    '[R-S02]',
    '[R-S02b]',
    '[R-S04]',
    '[R-S04b]',
    '[R-S04c]',
    '[R-S04d]',
    '[R-S04e]',
    '[R-S05]',
    '[R-S05b]',
    '[R-S07]',
    '[R-S10b]',
    '[R-S12]',
  ]),
});
