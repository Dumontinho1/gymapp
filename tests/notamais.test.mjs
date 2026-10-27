// Testes do robô de prospecção do NotaMais (sem rede: só dados de exemplo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telefoneBR, melhorTelefone, osmParaLugares, lerCSV, csvParaLugares, processar } from '../notamais/buscar-leads.mjs';

test('telefone: celular x fixo, com e sem +55', () => {
  assert.deepEqual(telefoneBR('(31) 99876-5432'), { e164: '5531998765432', ddd: '31', celular: true });
  assert.equal(telefoneBR('+55 31 3222-1100').celular, false);
  assert.equal(telefoneBR('0800 123 4567'), null);
  assert.equal(melhorTelefone('+55 31 3222-1100; +55 31 98888-7777'), '+55 31 98888-7777');
});

test('OpenStreetMap: só com nome e telefone, categoria traduzida, prefere celular', () => {
  const l = osmParaLugares([
    { type: 'node', id: 1, tags: { name: 'Barbearia Savassi', shop: 'hairdresser', phone: '+55 31 3333-4444;+55 31 99999-1111', 'addr:street': 'Rua Pernambuco', 'addr:housenumber': '100', 'addr:suburb': 'Savassi' } },
    { type: 'way', id: 2, tags: { name: 'Sem Telefone', amenity: 'restaurant' } },
    { type: 'node', id: 3, tags: { shop: 'pet', phone: '31999990000' } },
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].categoria, 'salão/barbearia');
  assert.equal(l[0].nationalPhoneNumber, '+55 31 99999-1111');
  const [lead] = processar(l, 'Ana', 'Belo Horizonte, MG');
  assert.equal(lead.semAvaliacoes, true);
  assert.equal(lead.score, 70);
  assert.match(lead.mensagem, /^Olá! Aqui é Ana\. Vi a Barbearia Savassi aqui em Belo Horizonte/);
  assert.match(processar(l, '', 'Belo Horizonte')[0].mensagem, /^Olá, tudo bem\? Vi a Barbearia Savassi/);
  assert.match(lead.maps, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.match(lead.whatsapp, /^https:\/\/wa\.me\/5531999991111\?text=/);
  assert.equal(lead.telefoneTexto, '(31) 99999-1111');
});

test('planilha Outscraper (vírgula) e Apify (ponto e vírgula) com aspas e quebras de linha', () => {
  const outscraper = 'name,full_address,phone,rating,reviews,type,place_id,location_link,business_status\n'
    + '"Studio ""Bela"" BH","Av. Afonso Pena, 1000 - Centro, Belo Horizonte",+55 31 98765-4321,4.3,22,Salão de beleza,ChIJabc,https://www.google.com/maps/place/x,OPERATIONAL\n'
    + 'Fechado Ltda,"Rua X",+55 31 98765-0000,4.0,10,Bar,ChIJdef,,CLOSED_PERMANENTLY\n';
  const a = csvParaLugares(lerCSV(outscraper));
  assert.equal(a.length, 2);
  assert.equal(a[0].displayName.text, 'Studio "Bela" BH');
  assert.equal(a[0].rating, 4.3);
  assert.equal(a[0].userRatingCount, 22);
  const leads = processar(a, 'Ana', 'Belo Horizonte, MG');
  assert.equal(leads.length, 1, 'negócio fechado sai');
  assert.match(leads[0].mensagem, /^Olá! Aqui é Ana\. Vi a Studio "Bela" BH no Google Maps: nota 4,3 com 22 avaliações/);

  const apify = '﻿title;address;phone;totalScore;reviewsCount;categoryName;url\n'
    + 'Oficina Pampulha;"Rua A,\n10";(31) 3456-7890;3,9;41;Oficina mecânica;javascript:alert(1)\n';
  const b = csvParaLugares(lerCSV(apify));
  assert.equal(b[0].displayName.text, 'Oficina Pampulha');
  assert.equal(b[0].rating, 3.9);
  assert.equal(b[0].formattedAddress, 'Rua A,\n10');
  assert.equal(b[0].googleMapsUri, '', 'URL não-Google é descartada');
});
