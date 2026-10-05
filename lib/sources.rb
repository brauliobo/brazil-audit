# The TSE open data files of 2018 (https://dadosabertos.tse.jus.br/dataset/resultados-2018 and its sibling datasets),
# in download order: what the importer needs first
module Sources
  CDN    = 'https://cdn.tse.jus.br/estatistica/sead'
  UFS    = %w[AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO]
  ODSELE = %w[
    consulta_cand/consulta_cand_2018 detalhe_votacao_secao/detalhe_votacao_secao_2018
    detalhe_votacao_munzona/detalhe_votacao_munzona_2018 votacao_candidato_munzona/votacao_candidato_munzona_2018
    votacao_partido_munzona/votacao_partido_munzona_2018
  ]
  EXTRAS = %w[
    consulta_cand_complementar/consulta_cand_complementar_2018 consulta_coligacao/consulta_coligacao_2018
    consulta_vagas/consulta_vagas_2018 motivo_cassacao/motivo_cassacao_2018
    eleitorado_locais_votacao/eleitorado_local_votacao_2018
  ]
  # the timestamps in the names are the generation time of each file; the foreign vote (ZZ) is in the BR file of
  # votacao_secao and has files of its own in the urn datasets
  BU     = { '1t' => '101020181938', '2t' => '301020181744' }
  BU_ZZ  = BU.merge '1t' => '111020181508'
  CEFT   = { '1t' => '111020180053', '2t' => '301020182242' }

  def self.all
    secao = (%w[BR] + UFS).map{ |uf| "votacao_secao/votacao_secao_2018_#{uf}" }
    (ODSELE + secao + EXTRAS).map{ |n| "#{CDN}/odsele/#{n}.zip" } +
      (UFS + %w[ZZ]).flat_map{ |uf| urns(uf) + ["#{CDN}/odsele/perfil_eleitor_secao/perfil_eleitor_secao_2018_#{uf}.zip"] }
  end

  def self.urns uf
    %w[1t 2t].flat_map do |t|
      bu = (uf == 'ZZ' ? BU_ZZ : BU)[t]
      ["#{CDN}/eleicoes/eleicoes2018/buweb/BWEB_#{t}_#{uf}_#{bu}.zip",
       "#{CDN}/eleicoes/eleicoes2018/correspefet/#{t}/CEFT_#{t}_#{uf}_#{CEFT[t]}.zip"]
    end
  end

  def self.name(url) = File.basename(url)
end
