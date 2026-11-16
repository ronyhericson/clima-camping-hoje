import { useEffect } from 'react'

// Dados do responsável pelo site. Preencha o e-mail de contato para dúvidas,
// correções de campings e pedidos sobre dados pessoais (LGPD).
export const SITE = {
  nome: 'ClimaCampingHoje',
  contato: 'ronyhericson@gmail.com', // ex.: 'contato@seudominio.com.br'
  atualizado: '12/11/2026',
}

const A = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
)

export default function AboutModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about" role="dialog" aria-modal="true" aria-labelledby="sobre-titulo">
        <header className="modal-head">
          <h2 id="sobre-titulo">Sobre, créditos e privacidade</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar" autoFocus>
            ✕
          </button>
        </header>

        <div className="about-body">
          <section>
            <h3>Sobre</h3>
            <p>
              O {SITE.nome} mostra o tempo agora e a previsão do dia nos campings monitorados do estado de São Paulo. A previsão
              combina vários modelos meteorológicos e calcula a mediana e o grau de concordância entre eles. O site é gratuito,
              não tem anúncios e não tem vínculo com os campings listados.
            </p>
          </section>

          <section className="about-alert">
            <h3>Aviso importante</h3>
            <p>
              O laudo de risco é uma <b>classificação automática</b> feita a partir de previsões numéricas, sem garantia de acerto.
              Ele <b>não substitui os alertas oficiais</b> do{' '}
              <A href="https://alertas2.inmet.gov.br/">INMET</A> e da <A href="https://www.defesacivil.sp.gov.br/">Defesa Civil</A>.
              Em caso de alerta oficial, temporal ou raios, siga as orientações das autoridades.
            </p>
            <p>
              Nomes, endereços e localizações dos campings vêm de fontes públicas e podem estar desatualizados. Confirme
              funcionamento, acesso e condições diretamente com o camping. As marcas e nomes citados pertencem aos seus donos.
            </p>
          </section>

          <section>
            <h3>Fontes de dados e créditos</h3>
            <ul>
              <li>
                Previsão: <A href="https://open-meteo.com/">Open-Meteo</A> (CC BY 4.0), com os modelos ECMWF, GFS/NOAA, ICON/DWD,
                UKMO/Met Office, Météo-France e JMA.
              </li>
              <li>
                Fonte reserva: dados de <A href="https://api.met.no/">MET Norway</A> (CC BY 4.0).
              </li>
              <li>
                Mapas, ruas, rotas e busca de endereços: dados ©{' '}
                <A href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</A> (ODbL), com mapas da{' '}
                <A href="https://openfreemap.org/">OpenFreeMap</A>, rotas do <A href="https://project-osrm.org/">OSRM</A>, postos no trajeto pelo{' '}
                <A href="https://overpass-api.de/">Overpass API</A> e busca do{' '}
                <A href="https://photon.komoot.io/">Photon</A>.
              </li>
              <li>
                Limites de mesorregiões e municípios: <A href="https://www.ibge.gov.br/">IBGE</A>.
              </li>
            </ul>
          </section>

          <section>
            <h3>Privacidade (LGPD)</h3>
            <ul>
              <li>
                <b>Sem cadastro, cookies de rastreamento, anúncios ou ferramentas de análise.</b> Nenhum dado é vendido.
              </li>
              <li>
                <b>No seu navegador</b> ficam salvos só a última consulta do tempo (para não repetir consultas) e se o painel
                está aberto ou fechado. Você pode apagar a qualquer momento limpando os dados do site no navegador.
              </li>
              <li>
                <b>Localização:</b> só é usada se você tocar em "Usar minha localização" na tela de rotas e permitir no navegador.
                Ela e os endereços digitados são enviados ao OSRM e ao Photon apenas para traçar a rota e buscar endereços, e
                não ficam guardados pelo site.
              </li>
              <li>
                <b>Acesso:</b> como em qualquer site, o endereço IP e dados técnicos do acesso passam pela hospedagem (Cloudflare)
                e pelos serviços de mapa e previsão que o seu navegador consulta, para entregar o conteúdo e proteger contra abusos.
              </li>
            </ul>
          </section>

          <section>
            <h3>Contato</h3>
            <p>
              {SITE.contato ? (
                <>
                  Dúvidas, correção de um camping ou pedidos sobre seus dados:{' '}
                  <a href={`mailto:${SITE.contato}`}>{SITE.contato}</a>.
                </>
              ) : (
                'Canal de contato em breve.'
              )}
            </p>
          </section>

          <p className="muted small">
            © {new Date().getFullYear()} {SITE.nome} · Atualizado em {SITE.atualizado}
          </p>
        </div>
      </div>
    </div>
  )
}
