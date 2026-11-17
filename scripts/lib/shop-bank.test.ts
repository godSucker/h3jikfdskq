import { describe, expect, it } from 'vitest'
import { bankPackMutants } from './shop-bank'

const item = (id: string, filter: string, articles: string) =>
  `<ShopItem itemId="${id}" category="material"><Filter>${filter}</Filter><ArticleItems>${articles}</ArticleItems></ShopItem>`
const gold = '<ArticleItem amount="2800" typeId="hardcurrency" />'
const spec = (id: string) => `<ArticleItem typeId="${id}" />`
const ids = new Set(['specimen_ee_13', 'specimen_aa_01', 'specimen_aa_02'])

describe('bankPackMutants', () => {
  it('links a single-mutant bank pack and keeps only the first price tier per filter', () => {
    const xml =
      item('bank_ee_13_10ct', 'Shop_Bank_EE_13_ct', gold + spec('Specimen_EE_13')) +
      item('bank_ee_13_25ct', 'Shop_Bank_EE_13_ct', gold + spec('Specimen_EE_13')) +
      item('bank_ee_13_60ct', 'Shop_Bank_EE_13_ct', gold + spec('Specimen_EE_13'))
    expect([...bankPackMutants(xml, ids)]).toEqual([['bank_ee_13_10ct', ['specimen_ee_13']]])
  })

  it('skips multi-specimen pools, packs without a filter, non-bank items and unknown mutants', () => {
    const xml =
      item('bank_pool', 'Shop_Bank_Pool', spec('Specimen_AA_01') + spec('Specimen_AA_02')) +
      '<ShopItem itemId="bank_nofilter"><ArticleItems>' +
      spec('Specimen_AA_01') +
      '</ArticleItems></ShopItem>' +
      item('LuckyBox_X', 'Shop_X', spec('Specimen_AA_01')) +
      item('bank_ghost', 'Shop_Bank_Ghost', spec('Specimen_ZZ_99'))
    expect(bankPackMutants(xml, ids).size).toBe(0)
  })

  it('keeps the same filter for different mutants separate', () => {
    const xml =
      item('bank_a', 'Shop_Bank_Same', spec('Specimen_AA_01')) +
      item('bank_b', 'Shop_Bank_Same', spec('Specimen_AA_02'))
    expect(bankPackMutants(xml, ids).size).toBe(2)
  })
})
