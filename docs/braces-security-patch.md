# Patch local de braces 3.0.3

A auditoria bloqueou a integração com o alerta
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
O alerta afeta versões até 3.0.3; a consulta ao registro npm durante esta
correção retornou 3.0.3 como versão mais recente, sem versão corrigida.

O patch pnpm limita a profundidade dos blocos no parser e verifica a
profundidade da árvore com um percurso iterativo antes de executar stringify,
compile ou expand. Árvores fornecidas diretamente e ciclos também são
rejeitados. O limite é 128 níveis, abaixo da profundidade que esgota a pilha.
Entradas excessivas produzem SyntaxError, como a validação de comprimento já
existente; aplicações que aceitam padrões externos devem tratar erros de
validação. Padrões comuns, intervalos, escapes, aspas e o limite aceito de
aninhamento têm testes de regressão.

A auditoria só aceita esse alerta depois de verificar a versão e os hashes
SHA-256 dos cinco arquivos corrigidos em cada cópia instalada, e executar os
testes de regressão. Outros alertas e artefatos diferentes continuam bloqueados.
A correção não elimina os limites e riscos próprios da expansão combinatória;
o escopo é a recursão excessiva descrita no alerta.

Quando houver uma versão corrigida oficial, atualizar a dependência, remover
este patch e sua exceção condicionada e repetir a CI completa.
