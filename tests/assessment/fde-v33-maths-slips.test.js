/**
 * bd-5jmnfj.33.4 — Grade 3-4 Maths answer-key defects the v32 review still found (REVIEW.md, Should-fix).
 *  G3 Maths Q2 iii: 43 x 3 common error names "forgetting the tens" but printed 109 (the slip gives 49).
 *  G3 Maths Q3 i / Q3 ii / Q4 i: "326 tens", "2488 hundreds", "33 tens and 2 ones" for answers 326, 2428, 362.
 *  G4 Maths Q2 iv: 5,100 / 14 accept line said "first three digits", the error named the right start (51) as the slip.
 *  G4 Maths Q3 iii / iv: errors starting with a digit smaller than the divisor (5 / 8, 3 / 24) with figures no slip gives.
 *  G4 Maths Q3 iv: the worked answer asks "? It goes into 36 once".
 *  G4 Maths Q2 ii, v, Q3 i, Q4 i, ii and G3 Maths Q2 i, iii: method marks / "with a correct method" where only a number is asked.
 *  G3 Maths Q1 vii: stem asks for a multiplication sentence, key is the bare number 24.
 * Fixtures are the real items from the v32 g3/g4 maths ch3 exam JSON (blooms, lines, checked dropped).
 */

const { mathsSlips } = require('../../bot/shared/services/assessment/fde-maths-slips');
const { midKeyFixes } = require('../../bot/shared/services/assessment/fde-mid-key-fixes');

const G3 = {
  q1ii: {"main_question":"Choose the correct option","question":"What is 9 x 6?","options":["a) 54","b) 45","c) 63"],"marks":1,"answer":"a) 54","slot":"g3.maths.A.mcq"},
  q1vii: {"main_question":"Choose the correct option","question":"Which multiplication sentence gives the same total as 4 x 6?","options":["a) 4 + 6","b) 4 x 4","c) 24"],"marks":1,"answer":"c) 24","slot":"g3.maths.A.mcq"},
  q2i: {"main_question":"Do as directed","question":"Find the missing number: 7 x ___ = 63","marks":2,"answer":"9","slot":"g3.maths.A.directed","scheme":{"points":[{"text":"Correct missing number with a correct method (for example, counting in 7s or using the table of 7)","marks":2,"kind":"A"}],"accept":["9 by reading the multiplication table of 7","9 by counting in 7s up to 63","9 by repeated addition of 7 until 63"],"common_error":"Writing 8 by stopping one step early in the table of 7 (56)."}},
  q2ii: {"main_question":"Do as directed","question":"Compare using <, > or =: 6 x 8 ___ 7 x 7","marks":2,"answer":"<","slot":"g3.maths.A.directed","scheme":{"points":[{"text":"Both values found correctly (48 and 49)","marks":1,"kind":"A"},{"text":"Correct sign written","marks":1,"kind":"A"}],"accept":["48 < 49","<"],"common_error":"Writing > after reading 6 x 8 as 54 instead of 48."}},
  q2iii: {"main_question":"Do as directed","question":"Multiply: 43 x 3 = ___","marks":2,"answer":"129","slot":"g3.maths.A.directed","scheme":{"points":[{"text":"Correct answer using a correct method for multiplying a 2-digit number by a 1-digit number","marks":2,"kind":"A"}],"accept":["129 by the vertical method with place value","129 by multiplying tens and ones separately and adding (120 + 9)"],"common_error":"Writing 109 by multiplying only the ones and forgetting to multiply the tens correctly."}},
  q2iv: {"main_question":"Do as directed","question":"Arrange in order from smallest to greatest: 6 x 9, 7 x 7, 8 x 6","marks":2,"answer":"8 x 6, 7 x 7, 6 x 9","slot":"g3.maths.A.directed","scheme":{"points":[{"text":"All three values found correctly (54, 49, 48)","marks":1,"kind":"A"},{"text":"Correct order written","marks":1,"kind":"A"}],"accept":["48, 49, 54 with the matching multiplications","8 x 6 < 7 x 7 < 6 x 9"],"common_error":"Writing 6 x 9, 7 x 7, 8 x 6, which is greatest to smallest."}},
  q3i: {"main_question":"Solve the following. Show your working.","question":"Multiply 47 x 8 using the vertical method.","marks":5,"slot":"g3.maths.B.short","answer":"Ones: 7 x 8 = 56 ones, write 6 and carry 5 tens. Tens: 4 x 8 = 32 tens, 32 + 5 = 37 tens. So 47 x 8 = 376.","scheme":{"points":[{"text":"A correct method: multiply ones, carry to tens, then multiply tens","marks":2,"kind":"M"},{"text":"Correct working for ones, the carry and the tens","marks":1,"kind":"M"},{"text":"Correct answer 376 (Answer written as a clear statement, 47 x 8 = 376)","marks":2,"kind":"A"}],"accept":["Place value method: 40 x 8 = 320, 7 x 8 = 56, 320 + 56 = 376","Repeated addition of 47, eight times, giving 376"],"common_error":"Forgetting to add the carried 5 tens gives 326 tens and an answer of 326."}},
  q3ii: {"main_question":"Solve the following. Show your working.","question":"Multiply 438 x 6 using the vertical method.","marks":5,"slot":"g3.maths.B.short","answer":"Ones: 8 x 6 = 48 ones, write 8 and carry 4 tens. Tens: 3 x 6 = 18 tens, 18 + 4 = 22 tens, write 2 and carry 2 hundreds. Hundreds: 4 x 6 = 24 hundreds, 24 + 2 = 26 hundreds. So 438 x 6 = 2628.","scheme":{"points":[{"text":"A correct method: multiply ones, tens and hundreds in turn, carrying each time","marks":2,"kind":"M"},{"text":"Correct working for each place and each carry","marks":1,"kind":"M"},{"text":"Correct answer 2628 (Answer written as a clear statement, 438 x 6 = 2628)","marks":2,"kind":"A"}],"accept":["Place value method: 400 x 6 = 2400, 30 x 6 = 180, 8 x 6 = 48, then 2400 + 180 + 48 = 2628"],"common_error":"Forgetting to add the carried 2 hundreds gives 2488 hundreds and an answer of 2428."}},
  q3iii: {"main_question":"Solve the following. Show your working.","question":"Multiply 305 x 7 using the vertical method.","marks":5,"slot":"g3.maths.B.short","answer":"Ones: 5 x 7 = 35 ones, write 5 and carry 3 tens. Tens: 0 x 7 = 0 tens, 0 + 3 = 3 tens. Hundreds: 3 x 7 = 21 hundreds. So 305 x 7 = 2135.","scheme":{"points":[{"text":"A correct method: multiply each place value and carry where needed","marks":2,"kind":"M"},{"text":"Correct working, including the carried 3 tens and the zero tens digit","marks":1,"kind":"M"},{"text":"Correct answer 2135 (Answer written as a clear statement, 305 x 7 = 2135)","marks":2,"kind":"A"}],"accept":["Place value method: 300 x 7 = 2100, 5 x 7 = 35, 2100 + 35 = 2135"],"common_error":"Leaving out the carried 3 tens gives an answer of 2105."}},
  q4i: {"main_question":"Read the problem and solve it. Show your working.","question":"A school buys 9 boxes of chalk. Each box holds 48 sticks of chalk. How many sticks of chalk does the school buy in all?","marks":5,"slot":"g3.maths.B.word_problem","answer":"Number sentence: 48 x 9. Ones: 8 x 9 = 72 ones, write 2 and carry 7 tens. Tens: 4 x 9 = 36 tens, 36 + 7 = 43 tens. 48 x 9 = 432. The school buys 432 sticks of chalk.","scheme":{"points":[{"text":"A correct method: choose multiplication because every box has an equal number","marks":2,"kind":"M"},{"text":"Correct working with the carry","marks":1,"kind":"M"},{"text":"Correct answer 432 (Unit or statement: 432 sticks of chalk)","marks":2,"kind":"A"}],"accept":["Repeated addition of 48, nine times, giving 432","Place value method: 40 x 9 = 360, 8 x 9 = 72, 360 + 72 = 432"],"common_error":"Forgetting to add the carried 7 tens gives 33 tens and 2 ones, so an answer of 362 sticks."}},
  t1: {"slot":"g3.maths.C.extended","main_question":"Answer parts (a), (b) and (c) for the number 7 x 8 x 1 given below. Attempt any 2 of the 3 tasks.","question":"Task 1: Use the numbers 24 and 7.\n(a) Write 24 x 7 using place value, as 24 ones groups: find 4 ones x 7 and 2 tens x 7.\n(b) Add the two partial results to find the total.\n(c) Write the total in hundreds, tens and ones.","marks":5,"answer":"(a) 4 ones x 7 = 28 ones; 2 tens x 7 = 14 tens = 140. (b) 28 + 140 = 168. (c) 168 = 1 hundred 6 tens 8 ones.","scheme":{"points":[{"text":"a correct method for splitting the number into tens and ones and multiplying each part","marks":2,"kind":"M"},{"text":"correct working for both partial results","marks":1,"kind":"M"},{"text":"correct total 168","marks":1,"kind":"A"},{"text":"correct place value statement: 1 hundred 6 tens 8 ones","marks":1,"kind":"A"}],"accept":["Vertical method giving 168 then 1 hundred 6 tens 8 ones","Repeated addition of 24 seven times giving 168"],"common_error":"Forgetting that 2 tens x 7 is 14 tens (140) and writing 14, which gives 42"}},
  t2: {"slot":"g3.maths.C.extended","main_question":"Answer parts (a), (b) and (c). Attempt any 2 of the 3 tasks.","question":"Task 2: Use the number 306 and the number 7.\n(a) Find 306 x 7 using the vertical method with place value steps.\n(b) Find the product of 6 x 7 and write the number of ones in it.\n(c) Write the digit in the hundreds place of 306 x 7 and say what it stands for.","marks":5,"answer":"(a) 6 ones x 7 = 42 ones, write 2 carry 4 tens; 0 tens x 7 = 0 tens + 4 tens = 4 tens; 3 hundreds x 7 = 21 hundreds. 306 x 7 = 2142. (b) 6 x 7 = 42, which is 42 ones. (c) 2142 has 1 in the hundreds place, which stands for 100.","scheme":{"points":[{"text":"a correct method for multiplying ones, tens and hundreds with carrying","marks":2,"kind":"M"},{"text":"correct working for each place","marks":1,"kind":"M"},{"text":"correct answer 2142","marks":1,"kind":"A"},{"text":"correct statements for 42 ones and the digit 1 standing for 100","marks":1,"kind":"A"}],"accept":["Splitting 306 as 300 + 6 and adding 2100 + 42"],"common_error":"Not adding the carried 4 tens, which gives 2102"}},
  t3: {"slot":"g3.maths.C.extended","main_question":"Answer parts (a), (b) and (c). Attempt any 2 of the 3 tasks.","question":"Task 3: Use the numbers 9 and 12.\n(a) Write 9 + 9 + 9 + 9 + 9 + 9 + 9 + 9 + 9 + 9 + 9 + 9 as a multiplication sentence.\n(b) Find its total by the table of 9 and by adding 90 and 18.\n(c) Write another multiplication sentence with the same total and say which is greater: 12 x 9 or 11 x 9.","marks":5,"answer":"(a) 12 x 9. (b) 9 x 10 = 90 and 9 x 2 = 18, so 90 + 18 = 108. (c) 9 x 12 = 108. 12 x 9 = 108 and 11 x 9 = 99, so 12 x 9 is greater.","scheme":{"points":[{"text":"a correct method for writing repeated addition as multiplication","marks":2,"kind":"M"},{"text":"correct working splitting into 90 and 18","marks":1,"kind":"M"},{"text":"correct total 108 and the other sentence 9 x 12 (correct statement that 12 x 9 is greater than 11 x 9)","marks":2,"kind":"A"}],"accept":["Counting in 9s twelve times to reach 108","Using 9 x 12 = 108 and 9 x 11 = 99 to compare"],"common_error":"Counting only 11 nines and writing 11 x 9 = 99 as the total"}},
};
const G4 = {
  q2i: {"slot":"g4.maths.A.directed","main_question":"Do as directed","question":"Write the missing word: Quotient x Divisor + Remainder = ______","marks":2,"answer":"Dividend","scheme":{"points":[{"text":"Recalls the relation used to check a division answer","marks":1,"kind":"M"},{"text":"Writes the correct word: Dividend","marks":1,"kind":"A"}],"accept":["Dividend","the dividend"],"common_error":"Writes Quotient or Divisor instead of Dividend"}},
  q2ii: {"slot":"g4.maths.A.directed","main_question":"Do as directed","question":"Find the value of 3,126 x 4.","marks":2,"answer":"3,126 x 4 = 12,504","scheme":{"points":[{"text":"A correct method for multiplying by a 1-digit number, aligning by place value and carrying over","marks":1,"kind":"M"},{"text":"Correct product: 12,504","marks":1,"kind":"A"}],"accept":["Vertical multiplication ones, tens, hundreds, thousands in order","Multiplying each place value separately and adding the parts"],"common_error":"Forgets to add the carried over digit, for example getting 12,404"}},
  q2iii: {"slot":"g4.maths.A.directed","main_question":"Do as directed","question":"Find the value of 1,350 x 24 by multiplying by the ones and the tens separately and then adding.","marks":2,"answer":"1,350 x 4 = 5,400; 1,350 x 20 = 27,000; 5,400 + 27,000 = 32,400","scheme":{"points":[{"text":"A correct method: multiply by ones, multiply by tens, then add both products","marks":1,"kind":"M"},{"text":"Correct answer: 32,400","marks":1,"kind":"A"}],"accept":["Vertical multiplication with 24 expanded as 20 + 4","Writing 24 = 20 + 4 and adding the two products"],"common_error":"Multiplies by 2 instead of 20, so the tens product is not shifted one place and the answer is wrong"}},
  q2iv: {"slot":"g4.maths.A.directed","main_question":"Do as directed","question":"Divide 5,100 by 14. Write the quotient and the remainder.","marks":2,"answer":"5,100 ÷ 14 = 364 with remainder 4","scheme":{"points":[{"text":"A correct method of long division: divide, multiply, subtract, bring down, repeat","marks":1,"kind":"M"},{"text":"Quotient 364 and remainder 4","marks":1,"kind":"A"}],"accept":["Long division with a 2-digit divisor, using the first three digits to start"],"common_error":"Writes the quotient without the remainder, or starts dividing with the first two digits only"}},
  q2v: {"slot":"g4.maths.A.directed","main_question":"Do as directed","question":"Complete the pattern: 3, 15, 75, 375, ______, ______","marks":2,"answer":"1,875 and 9,375 (each number is multiplied by 5)","scheme":{"points":[{"text":"Finds the rule: multiply each number by 5","marks":1,"kind":"M"},{"text":"Writes both missing numbers: 1,875 and 9,375","marks":1,"kind":"A"}],"accept":["Multiplying the previous number by 5 each time","Finding that each number is 5 times the one before"],"common_error":"Adds a number each time instead of multiplying by 5"}},
  q3i: {"slot":"g4.maths.B.short","main_question":"Solve the following. Show your working.","question":"Find the product of 3,745 and 6.","marks":5,"answer":"3,745 x 6: 5 ones x 6 = 30 ones; 4 tens x 6 = 24 tens; 7 hundreds x 6 = 42 hundreds; 3 thousands x 6 = 18 thousands. Total = 22,470. The product is 22,470.","scheme":{"points":[{"text":"a correct method of aligning the numbers by place value and multiplying the ones","marks":1,"kind":"M"},{"text":"multiplying the tens, hundreds and thousands with the carried digits","marks":2,"kind":"M"},{"text":"correct answer 22,470 (a statement of the result)","marks":2,"kind":"A"}],"accept":["Place value method: 18,000 + 4,200 + 240 + 30 = 22,470","Vertical multiplication with carrying"],"common_error":"Forgetting to carry a digit to the next place, giving 18,240."}},
  q3ii: {"slot":"g4.maths.B.short","main_question":"Solve the following. Show your working.","question":"Find 2,356 x 38 in written form.","marks":5,"answer":"2,356 x 8 = 18,848; 2,356 x 30 = 70,680; 18,848 + 70,680 = 89,528. The product is 89,528.","scheme":{"points":[{"text":"a correct method for the first partial product using the ones digit","marks":1,"kind":"M"},{"text":"a correct method for the second partial product using the tens digit, with the zero placed","marks":1,"kind":"M"},{"text":"a correct method for combining both partial products","marks":1,"kind":"M"},{"text":"correct answer 89,528 (a statement of the result)","marks":2,"kind":"A"}],"accept":["Expanding 38 as 30 + 8 and finding both products before adding","Vertical written method with two rows"],"common_error":"Leaving out the zero when multiplying by the tens, giving 18,848 + 7,068 = 25,916."}},
  q3iii: {"slot":"g4.maths.B.short","main_question":"Solve the following. Show your working.","question":"Find 5,376 ÷ 8 using long division.","marks":5,"answer":"8 goes into 53 six times (48), left 5. Bring down 7 to make 57; 8 goes into 57 seven times (56), left 1. Bring down 6 to make 16; 8 goes into 16 two times. The answer is 672.","scheme":{"points":[{"text":"names 53 as the first digits used and finds how many times 8 goes into 53","marks":1,"kind":"M"},{"text":"a correct method of subtracting and bringing down the next digit","marks":1,"kind":"M"},{"text":"a correct method of repeating the steps for the remaining digits","marks":1,"kind":"M"},{"text":"correct answer 672 with nothing left over (a statement of the result)","marks":2,"kind":"A"}],"accept":["Long division steps: divide, multiply, subtract, bring down","Repeated sharing by 8 in parts such as 4,800 + 480 + 96"],"common_error":"Starting with 5 alone and placing the first digit in the wrong place, giving 62 or 6,072."}},
  q3iv: {"slot":"g4.maths.B.short","main_question":"Solve the following. Show your working.","question":"Find 3,672 ÷ 24 using long division.","marks":5,"answer":"24 does not go into 3 or 36 as first digit? It goes into 36 once (24), left 12. Bring down 7 to make 127; 24 x 5 = 120, left 7. Bring down 2 to make 72; 24 x 3 = 72, left 0. The answer is 153.","scheme":{"points":[{"text":"names 36 as the first digits used and finds that 24 goes into 36 one time","marks":1,"kind":"M"},{"text":"a correct method of subtracting and bringing down the next digit to get 127","marks":1,"kind":"M"},{"text":"a correct method of repeating the steps with 127 and 72","marks":1,"kind":"M"},{"text":"correct answer 153 (a statement of the result)","marks":2,"kind":"A"}],"accept":["Long division with a 2-digit divisor","Repeated subtraction of multiples of 24"],"common_error":"Using 3 alone as the first digit, or placing the digits of the answer in the wrong places, giving 135 or 1,053."}},
  q4i: {"slot":"g4.maths.B.word_problem","main_question":"Solve the word problem. Show your working.","question":"A school shop sells bags for Rs. 1,450 each. A school buys 36 bags. How much money do they pay in total?","marks":5,"answer":"Number sentence: 1,450 x 36. 1,450 x 6 = 8,700; 1,450 x 30 = 43,500; 8,700 + 43,500 = 52,200. They pay Rs. 52,200.","scheme":{"points":[{"text":"a correct number sentence for the total cost","marks":1,"kind":"M"},{"text":"a correct method for the two partial products","marks":1,"kind":"M"},{"text":"a correct method for combining the partial products","marks":1,"kind":"M"},{"text":"correct answer Rs. 52,200 with the unit (a statement of the answer in a sentence)","marks":2,"kind":"A"}],"accept":["1,450 x 36 in written form","Expanding 36 as 30 + 6 before combining"],"common_error":"Using 1,450 + 36 or leaving out the zero in the tens row, giving 13,050."}},
  q4ii: {"slot":"g4.maths.B.word_problem","main_question":"Solve the word problem. Show your working.","question":"Sana plants 4,368 saplings in her garden in 21 equal rows. How many saplings are in each row?","marks":5,"answer":"Number sentence: 4,368 ÷ 21. 21 goes into 43 two times (42), left 1. Bring down 6 to make 16; 21 goes into 16 zero times. Bring down 8 to make 168; 21 x 8 = 168. The answer is 208. There are 208 saplings in each row.","scheme":{"points":[{"text":"a correct number sentence for equal sharing","marks":1,"kind":"M"},{"text":"names 43 as the first digits used and finds how many times 21 goes into 43","marks":1,"kind":"M"},{"text":"a correct method for the remaining steps, including a zero in the answer","marks":1,"kind":"M"},{"text":"correct answer 208 saplings in each row (a statement of the answer in a sentence)","marks":2,"kind":"A"}],"accept":["Long division by 21","Repeated subtraction of multiples of 21"],"common_error":"Missing the zero in the answer when 21 does not go into 16, giving 28."}},
  q5i: {"slot":"g4.maths.C.extended","main_question":"Answer any 2 of the 3 questions. Show your working.","question":"Multiply 2,306 by 35. Then divide your answer by 5. Write the final number.","marks":5,"answer":"2,306 x 5 = 11,530; 2,306 x 30 = 69,180; 11,530 + 69,180 = 80,710. Then 80,710 ÷ 5 = 16,142. The final number is 16,142.","scheme":{"points":[{"text":"a correct method for multiplying a 4-digit number by a 2-digit number (ones and tens parts)","marks":1,"kind":"M"},{"text":"a correct method for adding the two partial products","marks":1,"kind":"M"},{"text":"a correct method for dividing the product by 1-digit number","marks":1,"kind":"M"},{"text":"correct final number 16,142","marks":2,"kind":"A"}],"accept":["Multiplying by 35 as 2,306 x 5 and 2,306 x 30 then adding, then dividing by 5","Dividing 2,306 x 35 by 5 using long division"],"common_error":"Forgetting to put a zero when multiplying by the tens digit, so the tens product is 10 times too small."}},
  q5ii: {"slot":"g4.maths.C.extended","main_question":"Answer any 2 of the 3 questions. Show your working.","question":"Divide 6,475 by 25. Write the quotient and the remainder. Then check your answer using the equation Quotient x Divisor + Remainder.","marks":5,"answer":"25 goes into 64 two times (50), remainder 14; bring down 7 to make 147, 25 goes 5 times (125), remainder 22; bring down 5 to make 225, 25 goes 9 times, remainder 0. Quotient 259, remainder 0. Check: 259 x 25 + 0 = 6,475.","scheme":{"points":[{"text":"a correct method for long division by a 2-digit divisor (divide, multiply, subtract, bring down)","marks":3,"kind":"M"},{"text":"correct quotient 259 and remainder 0 (correct check: 259 x 25 + 0 = 6,475)","marks":2,"kind":"A"}],"accept":["Long division with repeated subtraction of multiples of 25"],"common_error":"Not bringing down the next digit after subtracting, or writing 0 in the quotient wrongly."}},
  q5iii: {"slot":"g4.maths.C.extended","main_question":"Answer any 2 of the 3 questions. Show your working.","question":"Rahim says 4,208 x 6 is greater than 25,000. Find 4,208 x 6 and say if Rahim is right. Explain your answer by comparing the two numbers.","marks":5,"answer":"6 x 8 ones = 48 ones, write 8 carry 4; 6 x 0 tens + 4 = 4 tens; 6 x 2 hundreds = 12 hundreds, write 2 carry 1; 6 x 4 thousands + 1 = 25 thousands. 4,208 x 6 = 25,248. 25,248 is greater than 25,000, so Rahim is right.","scheme":{"points":[{"text":"a correct method for multiplying a 4-digit number by a 1-digit number with carrying","marks":3,"kind":"M"},{"text":"correct product 25,248 (statement that Rahim is right because 25,248 is greater than 25,000)","marks":2,"kind":"A"}],"accept":["Multiplying place by place from ones to thousands","Splitting 4,208 as 4,000 + 200 + 8 and adding the products"],"common_error":"Forgetting to add the carried digit, giving 24,248 or similar."}},
};

const points = (q) => q.scheme.points;
const kinds = (q) => points(q).map((p) => p.kind).join('');
const total = (q) => points(q).reduce((n, p) => n + p.marks, 0);
const notesOf = (r, reason) => r.notes.filter((n) => n.reason === reason);

describe('a common error figure the named slip cannot give', () => {
  test('G3 Maths Q2 iii: forgetting the tens of 43 x 3 gives 49, never 109', () => {
    const r = mathsSlips(G3.q2iii);
    expect(r.q.scheme.common_error).toContain('49');
    expect(r.q.scheme.common_error).not.toContain('109');
    expect(notesOf(r, 'slip_figure')).toHaveLength(1);
  });

  test('a figure the slip does give is left alone', () => {
    const q = { ...G3.q2iii, scheme: { ...G3.q2iii.scheme, common_error: 'Forgetting to multiply the tens gives 49.' } };
    expect(mathsSlips(q).q.scheme.common_error).toBe('Forgetting to multiply the tens gives 49.');
  });

  test('G3 Maths Q3 i: "326 tens" becomes 32 tens, the answer 326 stays', () => {
    const e = mathsSlips(G3.q3i).q.scheme.common_error;
    expect(e).toContain('32 tens');
    expect(e).not.toContain('326 tens');
    expect(e).toContain('an answer of 326');
  });

  test('G3 Maths Q3 ii: "2488 hundreds" becomes 24 hundreds for the answer 2428', () => {
    const e = mathsSlips(G3.q3ii).q.scheme.common_error;
    expect(e).toContain('24 hundreds');
    expect(e).not.toContain('2488');
    expect(e).toContain('the carried 2 hundreds');
  });

  test('G3 Maths Q4 i: "33 tens and 2 ones" becomes 36 tens and 2 ones for 362', () => {
    const e = mathsSlips(G3.q4i).q.scheme.common_error;
    expect(e).toContain('36 tens and 2 ones');
    expect(e).not.toContain('33 tens');
    expect(e).toContain('the carried 7 tens');
  });

  test('a consistent place-value statement is not rewritten', () => {
    const q = { ...G3.q3i, scheme: { ...G3.q3i.scheme, common_error: 'Gives 32 tens and an answer of 326.' } };
    expect(mathsSlips(q).q).toBe(q);
  });
});

describe('division starts', () => {
  test('G4 Maths Q2 iv: the accept line names the first two digits (51), the correct start-as-error is dropped', () => {
    const q = mathsSlips(G4.q2iv).q;
    expect(q.scheme.accept.join(' ')).toContain('first two digits');
    expect(q.scheme.accept.join(' ')).not.toContain('first three digits');
    expect(q.scheme.common_error).toBe('Writes the quotient without the remainder');
    expect(q.scheme.common_error).not.toMatch(/first two digits/);
  });

  test('G4 Maths Q3 iii: a start with 5 alone for 5,376 / 8 is impossible, so the error is dropped', () => {
    const r = mathsSlips(G4.q3iii);
    expect(r.q.scheme.common_error).toBe('');
    expect(JSON.stringify(r.q)).not.toMatch(/6,072|\b62\b/);
    expect(notesOf(r, 'impossible_start')).toHaveLength(1);
  });

  test('G4 Maths Q3 iv: a start with 3 alone for 3,672 / 24 is impossible, so the error is dropped', () => {
    expect(mathsSlips(G4.q3iv).q.scheme.common_error).toBe('');
  });

  test('G4 Maths Q3 iv: the question mark in the working becomes the real first step', () => {
    const a = mathsSlips(G4.q3iv).q.answer;
    expect(a).not.toContain('?');
    expect(a).toMatch(/^24 does not go into 3, so start with 36: 36 ÷ 24 = 1 remainder 12\. Bring down 7 to make 127/);
    expect(a).toContain('The answer is 153.');
  });

  test('a start with a digit that does reach the divisor is a real slip and stays', () => {
    const q = { ...G4.q3iv, scheme: { ...G4.q3iv.scheme, common_error: 'Using 4 alone as the first digit gives a quotient of 1,053.' },
      question: 'Find 3,672 ÷ 3 using long division.' };
    expect(mathsSlips(q).q.scheme.common_error).toBe(q.scheme.common_error);
  });

  test('a division that is not Grade 3-4 Maths is untouched', () => {
    const q = { ...G4.q3iv, slot: 'g5.maths.B.short' };
    expect(mathsSlips(q).q).toBe(q);
  });
});

describe('method marks where the stem asks for a number', () => {
  test('G4 Maths Q2 ii (3,126 x 4): M relabelled A, marks kept', () => {
    const q = mathsSlips(G4.q2ii).q;
    expect(kinds(q)).toBe('AA');
    expect(total(q)).toBe(total(G4.q2ii));
  });

  test('G4 Maths Q2 v (pattern), Q3 i (product of 3,745 and 6), Q4 i, Q4 ii: no M left', () => {
    ['q2v', 'q3i', 'q4i', 'q4ii'].forEach((k) => {
      const q = mathsSlips(G4[k]).q;
      expect(kinds(q)).toMatch(/^A+$/);
      expect(total(q)).toBe(total(G4[k]));
    });
  });

  test('stems that ask for a method keep their M marks: separately, written form, long division, explain', () => {
    ['q2iii', 'q3ii', 'q3iii', 'q3iv', 'q5iii'].forEach((k) => {
      expect(mathsSlips(G4[k]).q.scheme.points.map((p) => p.kind)).toEqual(G4[k].scheme.points.map((p) => p.kind));
    });
  });

  test('G3 Maths Q2 i and iii: "with a correct method" / "using a correct method" removed from the point text', () => {
    const i = mathsSlips(G3.q2i).q;
    const iii = mathsSlips(G3.q2iii).q;
    expect(points(i)[0].text).not.toMatch(/correct method/);
    expect(points(iii)[0].text).not.toMatch(/correct method/);
    expect(points(i)[0].text).toMatch(/^Correct missing number/);
    expect(points(iii)[0].text).toMatch(/^Correct answer/);
    expect(points(i)[0]).toMatchObject({ marks: 2, kind: 'A' });
  });

  test('an M point that is only a value check (compare Q: "Correct value of each side") stays M', () => {
    const q = { slot: 'g3.maths.A.directed', question: 'Compare with <, > or =: 6 x 7 ___ 5 x 9', scheme: { points: [{ text: 'Correct value of each side (42 and 45)', marks: 1, kind: 'M' }], accept: [], common_error: '' } };
    expect(mathsSlips(q).q).toBe(q);
  });

  test('G3 Maths Q3 i (using the vertical method) keeps its M marks and its text', () => {
    expect(mathsSlips(G3.q3i).q.scheme.points).toEqual(G3.q3i.scheme.points);
  });
});

describe('an MCQ asking for a multiplication sentence', () => {
  test('G3 Maths Q1 vii (4 + 6 / 4 x 4 / 24, keyed 24): the key is not re-pointed at 4 x 4, it is flagged for re-ask', () => {
    const r = mathsSlips(G3.q1vii);
    expect(r.q.answer).toBe('c) 24');
    expect(notesOf(r, 'mcq_multiplication_key')).toEqual([expect.objectContaining({ action: 're-ask', slot: 'g3.maths.A.mcq' })]);
  });

  test('one option that is a multiplication equal to the stem product becomes the key', () => {
    const q = { ...G3.q1vii, options: ['a) 4 + 6', 'b) 6 x 4', 'c) 24'] };
    const r = mathsSlips(q);
    expect(r.q.answer).toBe('b) 6 x 4');
    expect(notesOf(r, 'mcq_multiplication_key')[0]).toMatchObject({ action: 'rekeyed', to: 'b) 6 x 4' });
  });

  test('a key that already is a multiplication sentence is untouched', () => {
    const q = { ...G3.q1vii, options: ['a) 4 + 6', 'b) 6 x 4', 'c) 24'], answer: 'b) 6 x 4' };
    expect(mathsSlips(q).q).toBe(q);
  });

  test('an MCQ not asking for a multiplication sentence is untouched', () => {
    expect(mathsSlips(G3.q1ii).q).toBe(G3.q1ii);
  });
});

describe('wired into midKeyFixes (Maths only)', () => {
  const exam = (slot, q) => ({ unseen: { x: { T: [q] } } });
  test('G4 Maths Q3 iv is rewritten through midKeyFixes with subject maths', () => {
    const out = midKeyFixes(exam('x', G4.q3iv), { subject: 'maths' });
    expect(out.examJson.unseen.x.T[0].answer).not.toContain('?');
    expect(out.notes.some((n) => n.reason === 'garbled_working')).toBe(true);
  });
  test('a non-Maths subject is not touched', () => {
    const out = midKeyFixes(exam('x', G4.q3iv), { subject: 'science' });
    expect(out.examJson.unseen.x.T[0].answer).toContain('?');
  });
});
