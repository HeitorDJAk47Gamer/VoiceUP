# Política de versões do VoiceUP

## Versões públicas

As versões públicas usam versionamento sem sufixo, por exemplo `1.1.0`.
Localmente, são mantidas as três versões públicas mais recentes em `releases/`.

## Versões beta

Toda beta usa exatamente a versão pública mais recente como base, seguida por
`-beta.N`, em que `N` começa em 1 e cresce a cada novo teste.

Exemplo com `1.1.0` como versão pública atual:

- `1.1.0-beta.1`
- `1.1.0-beta.2`
- `1.1.0-beta.3`

Ao publicar uma nova versão, por exemplo `1.2.0`, a contagem das betas reinicia:

- `1.2.0-beta.1`

Betas não ocupam as três vagas reservadas às versões públicas. Separadamente,
são mantidas apenas as três versões beta mais recentes, considerando primeiro
a versão pública-base e depois o número da beta.

Betas antigas não devem ser renomeadas, pois a versão também está gravada dentro
dos executáveis. Elas permanecem com o número que tinham quando foram compiladas.
