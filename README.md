# Brazil election audit: 2022 collector

The original script that collected the voting-machine files (info, log and RDV) of the 2022 presidential election, 2nd
round, kept as it was. It stores the votes of Lula (13) and Bolsonaro (22) per section in PostgreSQL. The 2026 collector
is in the `2026` branch and the analysis app in `main`.

The raw TSE files are release assets of this repository (`data-2022`): independent zips per state and kind
(`2022-aux-<uf>-NN.zip`, `2022-rdv-<uf>-NN.zip`, `2022-logs-<uf>-NN.zip`), restored by unzipping them in the data dir.
See the `2026` branch README for the commands.

MIT, see `LICENSE`. The data are public TSE files.
