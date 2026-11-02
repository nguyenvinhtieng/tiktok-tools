import vocabulary from './quiz-vocabulary.json' with { type: 'json' };

// User-supplied bilingual PDF. Levels are editorial quiz estimates, not Oxford CEFR labels.
// Original page/topic retained; sourceAnswer/sourceVi/sourcePos record corrected source errors.
export const SOURCES = [{
  name:'3000 từ vựng tiếng Anh thông dụng theo chủ đề · PDF nguồn',
  url:'/quiz-vocabulary.pdf'
}];
export const WORDS = vocabulary.filter(word=>/^[a-z]+$/i.test(word.answer));
export const VOCABULARY = {sourceRows:1760,uniqueWords:WORDS.length,levelSource:'estimated'};
