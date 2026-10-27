# Fatos eleitorais observados para consultas no navegador

46.594 margens e 410.334 categorias/candidatos em 82 CSVs gzip, com 41 anos observados entre 1945 e 2026. Presidente e governador por UF; prefeito por disputa municipal dentro da UF.

O arquivo state-facts.zip contém as duas tabelas normalizadas, manifest, índice e documentação. Os CSVs não têm cabeçalho; MANIFEST.json declara nomes, tipos, partes e hashes. População não se repete por candidato. Campos ausentes permanecem NULL, categorias incompletas são indicadas explicitamente e nenhuma diferença é transformada em voto residual.

Consultas e limites são calculados no navegador. Este pacote não contém matrizes de migração estimadas. STATE_FACTS.md descreve a metodologia factual; METHOD.md documenta apenas o modelo estatístico opcional, fora do fluxo padrão. As fontes originais não foram duplicadas: URL e SHA256 constam em cada linha.

Os dois diagnósticos estatísticos já executados permanecem opcionais no site e são inconclusivos. A coleta de modelos regionais foi interrompida; nenhum processamento reinicia automaticamente.
