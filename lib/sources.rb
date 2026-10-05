# The TSE open data files of a general election (https://dadosabertos.tse.jus.br/dataset/resultados-<year> and its sibling
# datasets), in download order: what the importer needs first
module Sources
  CDN    = 'https://cdn.tse.jus.br/estatistica/sead'
  UFS    = %w[AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO]
  ODSELE = %w[consulta_cand detalhe_votacao_secao detalhe_votacao_munzona votacao_candidato_munzona votacao_partido_munzona]
  EXTRAS = %w[consulta_cand_complementar consulta_coligacao consulta_vagas motivo_cassacao
              eleitorado_locais_votacao/eleitorado_local_votacao]

  # What differs by year, besides the election codes (config.rb):
  #   urn:    the urn datasets (BU and correspondência efetivada) have the generation time of each file in its name, by round;
  #           the BU prefix, the CEFT files in a directory by round (2018), and the first round BU of the foreign vote (ZZ)
  #           with another time (2018)
  #   extras: the files only that year has, relative to the CDN
  BY_YEAR = {
    '2018' => {
      urn:    { prefix: 'BWEB', ceft_by_round: true, bu: { '1t' => '101020181938', '2t' => '301020181744' },
                bu_zz: { '1t' => '111020181508' }, ceft: { '1t' => '111020180053', '2t' => '301020182242' } },
      extras: []
    },
    '2022' => {
      urn:    { prefix: 'bweb', ceft_by_round: false, bu: { '1t' => '051020221321', '2t' => '311020221535' }, bu_zz: {},
                ceft: { '1t' => '041020221233', '2t' => '311020221100' } },
      extras: %w[odsele/secoes_agregadas/secoes_agregadas_2022
                 odsele/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_2022
                 eleicoes/eleicoes2022/Historico_Totalizacao_Presidente_BR_1T_2022
                 eleicoes/eleicoes2022/Historico_Totalizacao_Presidente_BR_2T_2022
                 eleicoes/eleicoes2022/listaelesuplem/lista_eleicoes_suplementares_2022]
    }
  }.fetch YEAR

  # the foreign vote (ZZ) is in the BR file of votacao_secao
  def self.all
    secao = (%w[BR] + UFS).map{ |uf| "odsele/votacao_secao/votacao_secao_#{YEAR}_#{uf}" }
    (odsele(ODSELE) + secao + odsele(EXTRAS) + BY_YEAR[:extras]).map{ |n| "#{CDN}/#{n}.zip" } +
      (UFS + %w[ZZ]).flat_map{ |uf| urns(uf) + ["#{CDN}/odsele/perfil_eleitor_secao/perfil_eleitor_secao_#{YEAR}_#{uf}.zip"] }
  end

  # a name is the directory, or directory/file when the file has another name
  def self.odsele(names) = names.map{ |n| dir, file = n.split('/'); "odsele/#{dir}/#{file || dir}_#{YEAR}" }

  def self.urns uf
    urn = BY_YEAR[:urn]
    %w[1t 2t].flat_map do |t|
      bu = (uf == 'ZZ' && urn[:bu_zz][t]) || urn[:bu][t]
      ["#{CDN}/eleicoes/eleicoes#{YEAR}/buweb/#{urn[:prefix]}_#{t}_#{uf}_#{bu}.zip",
       "#{CDN}/eleicoes/eleicoes#{YEAR}/correspefet/#{"#{t}/" if urn[:ceft_by_round]}CEFT_#{t}_#{uf}_#{urn[:ceft][t]}.zip"]
    end
  end

  def self.name(url) = File.basename(url)
end
