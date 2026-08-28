// js/sign.js
// Page publique de signature — Kontra-Africa

const API_BASE =
  'https://kontra-africa.onrender.com';


const params =
  new URLSearchParams(
    window.location.search
  );


const token =
  params.get('token');


let signaturePad = null;


// ============================================================
// DOM
// ============================================================

const els = {

  loading:
    document.getElementById(
      'state-loading'
    ),

  error:
    document.getElementById(
      'state-error'
    ),

  errorMessage:
    document.getElementById(
      'error-message'
    ),

  alreadySigned:
    document.getElementById(
      'state-already-signed'
    ),

  alreadySignedDate:
    document.getElementById(
      'already-signed-date'
    ),

  downloadPdf:
    document.getElementById(
      'link-download-pdf'
    ),


  contractView:
    document.getElementById(
      'contract-view'
    ),

  contractTitle:
    document.getElementById(
      'contract-title'
    ),

  contractCreatorName:
    document.getElementById(
      'contract-creator-name'
    ),

  contractContent:
    document.getElementById(
      'contract-content'
    ),


  terms:
    document.getElementById(
      'checkbox-terms'
    ),

  typedName:
    document.getElementById(
      'input-typed-name'
    ),


  canvas:
    document.getElementById(
      'signature-canvas'
    ),


  clearSignature:
    document.getElementById(
      'btn-clear-signature'
    ),


  signError:
    document.getElementById(
      'sign-error'
    ),


  signButton:
    document.getElementById(
      'btn-sign'
    ),


  success:
    document.getElementById(
      'state-success'
    ),


  successPdf:
    document.getElementById(
      'link-download-pdf-success'
    )

};



// ============================================================
// AFFICHAGE
// ============================================================

function showState(state) {

  [
    els.loading,
    els.error,
    els.alreadySigned,
    els.contractView,
    els.success

  ].forEach((element)=>{

    if(element){

      element.hidden =
        element !== state;

    }

  });

}



// ============================================================
// API
// ============================================================

async function apiRequest(
  url,
  options = {}
){

  const response =
    await fetch(
      url,
      {
        ...options,

        headers:{
          Accept:
            'application/json',

          ...(options.headers || {})
        }
      }
    );


  const contentType =
    response.headers.get(
      'content-type'
    ) || '';


  let data = {};


  if(
    contentType.includes(
      'application/json'
    )
  ){

    data =
      await response
        .json()
        .catch(
          ()=>({})
        );

  }


  return {
    response,
    data
  };

}



// ============================================================
// URL PDF CLIENT
// ============================================================

function getPdfUrl(){

  return (
    `${API_BASE}/api/contracts/public/`+
    `${encodeURIComponent(token)}/pdf`
  );

}



// ============================================================
// CHARGEMENT CONTRAT
// ============================================================

async function init(){

  if(!token){

    els.errorMessage.textContent =
      'Lien invalide.';

    showState(
      els.error
    );

    return;

  }


  try{


    const {
      response,
      data
    } =
      await apiRequest(
        `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}`
      );


    if(!response.ok){

      throw new Error(
        data.message ||
        'Contrat introuvable.'
      );

    }


    if(
      data.status === 'signed'
    ){

      els.alreadySignedDate.textContent =
        formatDate(
          data.signerSignedAt
        );


      showState(
        els.alreadySigned
      );


      return;

    }


    if(
      data.status !== 'pending'
    ){

      throw new Error(
        'Ce contrat n’est plus disponible.'
      );

    }


    els.contractTitle.textContent =
      data.title || '';


    els.contractCreatorName.textContent =
      data.creatorName || '';


    els.contractContent.textContent =
      data.content || '';


    showState(
      els.contractView
    );


    initSignaturePad();



  }catch(error){

    console.error(
      error
    );


    els.errorMessage.textContent =
      error.message;


    showState(
      els.error
    );

  }
// ============================================================
// SIGNATURE PAD
// ============================================================

function initSignaturePad(){

  if(!els.canvas){
    return;
  }


  const ctx =
    els.canvas.getContext(
      '2d'
    );


  let drawing = false;


  function position(e){

    const rect =
      els.canvas.getBoundingClientRect();


    const point =
      e.touches
      ? e.touches[0]
      : e;


    return {
      x:
        point.clientX -
        rect.left,

      y:
        point.clientY -
        rect.top
    };

  }


  function start(e){

    drawing = true;

    const p =
      position(e);

    ctx.beginPath();

    ctx.moveTo(
      p.x,
      p.y
    );

  }


  function draw(e){

    if(!drawing)
      return;


    e.preventDefault();


    const p =
      position(e);


    ctx.lineWidth =
      2;


    ctx.lineCap =
      'round';


    ctx.strokeStyle =
      '#000000';


    ctx.lineTo(
      p.x,
      p.y
    );


    ctx.stroke();

  }


  function stop(){

    drawing = false;

  }



  els.canvas.addEventListener(
    'mousedown',
    start
  );

  els.canvas.addEventListener(
    'mousemove',
    draw
  );

  window.addEventListener(
    'mouseup',
    stop
  );


  els.canvas.addEventListener(
    'touchstart',
    start,
    {
      passive:false
    }
  );


  els.canvas.addEventListener(
    'touchmove',
    draw,
    {
      passive:false
    }
  );


  window.addEventListener(
    'touchend',
    stop
  );



  els.clearSignature?.addEventListener(
    'click',
    ()=>{

      ctx.clearRect(
        0,
        0,
        els.canvas.width,
        els.canvas.height
      );

    }
  );


}



// ============================================================
// ENVOI SIGNATURE
// ============================================================

async function signContract(){


  els.signError.hidden =
    true;


  const name =
    els.typedName.value.trim();



  if(
    !els.terms.checked
  ){

    els.signError.textContent =
      'Veuillez accepter le contrat.';

    els.signError.hidden =
      false;

    return;

  }



  if(
    name.length < 2
  ){

    els.signError.textContent =
      'Veuillez saisir votre nom complet.';

    els.signError.hidden =
      false;

    return;

  }



  const signature =
    els.canvas
      .toDataURL(
        'image/png'
      );



  els.signButton.disabled =
    true;


  els.signButton.textContent =
    'Signature en cours...';



  try{


    const {
      response,
      data
    } =
      await apiRequest(
        `${API_BASE}/api/contracts/public/${encodeURIComponent(token)}/sign`,
        {

          method:'POST',

          headers:{
            'Content-Type':
              'application/json'
          },


          body:
            JSON.stringify({

              signerName:
                name,

              signatureDataUrl:
                signature

            })

        }
      );



    if(!response.ok){

      throw new Error(
        data.message ||
        'Erreur lors de la signature.'
      );

    }



    const pdfUrl =
      data.pdfUrl ||
      getPdfUrl();



    // affichage succès

    showState(
      els.success
    );



    if(els.successPdf){

      els.successPdf.href =
        pdfUrl;

    }



    if(els.downloadPdf){

      els.downloadPdf.href =
        pdfUrl;

    }



    // ==================================================
    // TELECHARGEMENT AUTOMATIQUE CLIENT
    // ==================================================

    setTimeout(
      ()=>{

        const link =
          document.createElement(
            'a'
          );


        link.href =
          pdfUrl;


        link.download =
          'contrat-kontra-africa.pdf';


        document.body.appendChild(
          link
        );


        link.click();


        link.remove();


      },
      800
    );



  }catch(error){


    console.error(
      error
    );


    els.signError.textContent =
      error.message;


    els.signError.hidden =
      false;



    els.signButton.disabled =
      false;


    els.signButton.textContent =
      'Signer le contrat';

  }


}



// ============================================================
// UTIL DATE
// ============================================================

function formatDate(value){

  if(!value)
    return '';


  const d =
    new Date(value);


  if(
    Number.isNaN(
      d.getTime()
    )
  )
    return '';



  return d.toLocaleDateString(
    'fr-FR'
  );

}



// ============================================================
// INIT
// ============================================================

els.signButton?.addEventListener(
  'click',
  signContract
);


init();
}
