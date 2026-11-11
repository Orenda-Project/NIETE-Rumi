## Appendix A: FICO17 v6 indicator text (binding)

Extracted word for word from `Coaching Framework/FICO17_v6_rubric.md` (final 29 Oct 2026, edited 2 Nov 2026). Only the rationale ("Why") and the old v5 text are left out. Generate `fico17_v6.rubric.json` from this appendix or from that file. Level labels: 1 Not Observed, 2 Developing, 3 Proficient, 4 Highly Effective. In each block, a line starting `e.g.` is that level's example.

> **Conflict note:** the "Combined indicator" lines below say the DC reports "the level the transcript alone supports". Under §12 Q1 this spec assumes the DC prompt gives **evidence only** for combined indicators, and the transcript-only result is stored as a hidden `dc_result` from the `/observe2` rules. When you build the rubric JSON, keep the text word for word in `combined_evidence`. Do **not** render the "and the level the transcript alone supports" clause into the DC prompt unless Q1 is answered "yes".

### A.0 General rules from the rubric file

**Who sets the level.** There are two kinds of indicator.
- **Digital Coach (DC) indicators:** C1, C2, C4, C6, C8, D1, D5, F1, F2, F3, F4. The DC sets the level from the transcript.
- **Combined indicators:** C3, C5, C7, D2, D3, D4. These depend on things a transcript cannot show: which child spoke, pointing, seating, silent group work, anything off-mic. The DC reports what it finds in the transcript and the level the transcript alone supports. The coach adds what they saw in the room (listed under "Coach adds" in each entry), sets the final level, and always writes a justification: what they saw, and how the DC's evidence fits with it. A level without a justification is not accepted.

**Couldn't tell (to be tested).** Every indicator has a "couldn't tell" option, separate from N/A. N/A means the thing the indicator looks for did not come up (for example no student-to-student talk for D3). Couldn't tell means it may have happened but the recording cannot show it: the transcript stops early, starts mid-lesson, repeats one word for minutes, or the part of the lesson needed is missing or garbled. Each entry has a "Couldn't tell" line saying when to use it. Couldn't tell is not reported to the teacher as a level. On a combined indicator the DC's couldn't tell means it has no evidence to give; the coach still sets the level from what they saw.

A number in a level counts things that can be found in the transcript: answers, questions, times the teacher does something. It never counts different children by the Student label, because the transcript labels every child "Student" and cannot show how many different children spoke. The one exception is names the teacher says aloud (C3 L4): they are in the teacher's own words, so different names called can be counted. D2 is the other: its levels count different children, and that count comes from the coach, not the transcript.

**The codes.** C is what the teacher does, D is what the children do, F is what the teacher says about the subject. Each entry starts with a short definition of what the indicator measures. An "N/A link" line says which indicator is N/A when another is scored 1. The pipeline sets this from the score, so it is not part of the level text.

### C1 Quality of Questions Asked by the Teacher
*Was: Quality Questioning*  
**Definition:** What kinds of questions the teacher asks, and whether they make children think. A closed question needs a yes/no or one-word answer, an open question needs a longer answer, and the strongest questions ask "why" and are followed up.  
**N/A link:** C3 and D4 are N/A when C1 is scored 1.  
**Couldn't tell:** the teacher's speech is missing or garbled for a large part of the lesson, so the questions cannot be made out.  

**Proposed**
```
1  No questions asked by the teacher, or asks the questions but gives the answers without waiting for students to answer.
     e.g. Teacher: "What is the capital of Pakistan? Islamabad. Write it down."
2  Teacher only asks closed questions with yes/no or one word answers.
     e.g. Teacher: "Is a cow a mammal?" Student: "Yes."
3  Teacher asks at least two open questions and waits for students to answer.
     e.g. Teacher: "Ali, how did you work that out?" (waits) Student: "I counted in twos."
4  Teacher asks at least one question using 'why' and then follows up on the same child's answer (why? how do you know?).
     e.g. Teacher: "Why does a plant need water?" Student: "To grow." Teacher: "How do you know it helps it grow?"
```

### C2 Helping when a child is wrong
*Was: Responsive Re-explanation & Feedback*  
**Definition:** What the teacher does when a child's answer is wrong or incomplete: ignores it, says it is wrong, explains why, or helps the child fix it. It only applies when an answer was actually wrong.  
**Couldn't tell:** student answers are too garbled to tell whether any of them was wrong.  

**Proposed**
```
1  A student gives a wrong answer and the teacher ignores it, or only repeats the same explanation in the same words.
     e.g. Student: "Seven." Teacher: "Next one."
2  The teacher says the answer is wrong, or explains again, but gives the reason for the correction at most once.
     e.g. Teacher: "No, that is wrong. It is nine."
3  At least two times, the teacher gives the reason for the correction and says what was right and what to change.
     e.g. Teacher: "Not quite. You counted the 4 twice, so it is 9, not 13."
4  Beyond level 3, the teacher asks the student or another student to fix the answer, and tries a new way (a new example, a picture, smaller steps) if they are still stuck.
     e.g. Teacher: "Ali, what do you do first?" ... "Still stuck? Let me show you with sticks."
```

### C3 Who got to answer
*Was: Equitable & Inclusive Participation*  
**Definition:** How the teacher chooses who answers: only children who put a hand up or call out, or ways of bringing in other children, such as calling different children by name, pair talk, or everyone writing an answer.  
**N/A link:** C3 is N/A when C1 is scored 1.  
**Combined indicator.** The DC reports the times the teacher names a child before a question or sets pair talk or "everyone write", and the level the transcript alone supports.  
**Coach adds:** choosing that cannot be heard (pointing, a nod, "you tell" with no name), and whether children who had not put a hand up were brought in. The coach sets the final level with a written justification.  
**Couldn't tell (DC):** the teacher's speech before student answers is missing or garbled.  

**Proposed**
```
1  The teacher asks the whole class and takes whoever answers. No way of choosing who answers is heard: no name called before the question, no talking in pairs, no "everyone write".
     e.g. Teacher: "Who knows?" Student: "Me, me!" Teacher: "Yes, you."
2  The teacher uses a way of choosing who answers one time, for example calls a student by name, then goes back to taking whoever answers.
     e.g. Teacher: "Sara, what is your answer?" ... then "Who knows?" for the rest of the lesson.
3  At least two times, the teacher uses a way of choosing who answers (a name called before the question, "tell your partner", "everyone write your answer", names picked at random).
     e.g. Teacher: "Ali, what do you think?" ... later: "Everyone, tell your partner your answer." (two times: a name called, then pair talk)
4  Beyond level 3, the teacher calls at least two different names to answer, and each is followed by an answer.
     e.g. Teacher: "Ali, what is seven plus five?" Student: "Twelve." ... later: Teacher: "Ayesha, what is nine plus six?" Student: "Fifteen." (two different names called before the question, each followed by an answer)
```

### C4 Children's choices
*Was: Student Agency & Voice*  
**Definition:** Whether children have a say in how the lesson goes: a real choice about how to do the work or explain it, the teacher taking up a child's idea, or a part of the lesson handed to them. Small choices (who goes first, which colour) are not real choices.  
**Couldn't tell:** the teacher's instructions for the tasks are missing or garbled.  

**Proposed**
```
1  The teacher decides everything and asks students for no choice or idea.
     e.g. Teacher: "Open your copy. Write the date. Copy this sentence."
2  The teacher lets students choose only small things (who goes first, which colour), and decides everything about the learning.
     e.g. Teacher: "Which colour pen do you want to use?"
3  The teacher gives students at least one real choice about how to do the work or how to explain it, and lets them follow it, or takes up a child's idea.
     e.g. Teacher: "You can draw it or write it, you decide." / "Use any method you like." / Student: "Miss, can we draw it first?" Teacher: "Good idea, we will draw it first."
4  Beyond level 3, the teacher hands a part of the lesson to students: a student or a group leads an activity, picks the method, or teaches the others.
     e.g. Teacher: "Ali, come to the board and show everyone how you did it. We will do it Ali's way."
```

### C5 Switching activities
*Was: Classroom Management*  
**Definition:** How smoothly the class moves from one activity to the next: whether the teacher gives a clear signal and how long the change takes.  
**Combined indicator.** The DC reports the teacher's signals for each change of activity, with timestamps, and the level the transcript alone supports.  
**Coach adds:** how long the class actually took to settle into the next activity (chairs moved, books out, working), which the transcript times only roughly. The coach sets the final level with a written justification.  
**Couldn't tell (DC):** the transcript has gaps around the changes of activity, so the signals or times cannot be read.  

**Proposed**
```
1  The class takes more than three minutes to change activity, and the teacher gives no clear signal.
     e.g. Teacher: "Now... no, wait... take out your... everyone, listen... take out your copies." (more than three minutes pass)
2  The teacher gives a signal, but the change still takes two to three minutes.
     e.g. Teacher: "Now group work." (the class is still moving chairs; group work starts about three minutes later)
3  The class changes activity in under two minutes of the teacher's signal.
     e.g. Teacher: "Pens down, now turn to page 20." (the next activity starts at once; check the times)
4  Beyond level 3, students already know what comes next and change without being told.
     e.g. Student: "Miss, is it group work now?" (they are already moving)
```

### C6 Safe to be wrong
*Was: Positive & Supportive Learning Environment*  
**Definition:** Whether children feel safe to try and be wrong: how the teacher responds to their answers, whether praise is for effort or only for right answers, and whether mistakes are treated as useful.  
**Couldn't tell:** the teacher's replies to student answers are missing or garbled for a large part of the lesson.  

**Proposed**
```
1  The teacher gives no encouragement. Replies to students are flat, dismissive, or only about the task.
     e.g. Teacher: "Wrong. Sit down." / "Next."
2  The teacher praises, but only for right answers or for doing as told, and only in general words.
     e.g. Teacher: "Good." / "Well done." (only after right answers)
3  At least two times, the teacher praises a student's effort, trying, or thinking, not just a right answer.
     e.g. Teacher: "Good try, Ali, you were thinking the right way." / "Thank you for having a go."
4  Beyond level 3, the teacher treats a wrong answer or an attempt as useful, and also invites other views.
     e.g. Teacher: "That is a good mistake, it shows us what to check. Does anyone see it differently?"
```

### C7 Group work
*Was: Student Grouping & Collaboration*  
**Definition:** Whether the teacher sets real pair or group work: a task the group can only finish together, with something to make, roles and a report back. Sitting together but working alone is not group work.  
**Combined indicator.** The DC reports the teacher's spoken set-up (pairs or groups, a shared task, what the group must make, roles, report back) and the level the transcript alone supports.  
**Coach adds:** whether the groups actually worked together on one product and used the roles, which is mostly silent or too quiet for the recording. The coach sets the final level with a written justification.  
**Couldn't tell (DC):** the part of the lesson where group work is set or reported back is missing or garbled.  

**Proposed**
```
1  The teacher gives no pair or group task. Everyone works alone or as one class.
2  The teacher puts students in pairs or groups, but each student does their own work.
     e.g. Teacher: "Sit in your groups. Each of you write the answer in your own copy."
3  The teacher gives a task that a group can only finish together, and says what the group must make.
     e.g. Teacher: "In your group, make one chart together. Put everyone's ideas on it."
4  Beyond level 3, the teacher gives roles or turns inside the group, and asks the group to report back.
     e.g. Teacher: "One of you is the writer, one is the speaker. Each group will tell us what you found."
```

### C8 Books and materials
*Was: Use of Manipulatives & Learning Aids*  
**Definition:** Whether books, the board, charts or objects are used for learning, and by whom: only shown by the teacher, used by the children, or used by a child to explain while the teacher builds on what the child says.  
**Couldn't tell:** the teacher's instructions are missing or garbled for a large part of the lesson.  

**Proposed**
```
1  The teacher never mentions a book, the board, a chart, or any object or picture.
2  The teacher mentions a book, the board, or an object only to show or tell, and does not ask students to use it.
     e.g. Teacher: "Look at the board." / "I will show you with these sticks."
3  The teacher asks students to use a book, the board, or an object themselves, and says how it connects to the idea.
     e.g. Teacher: "Open your book to page 12 and find the picture of the plant. See, the roots are at the bottom."
4  Beyond level 3, the teacher asks a student to explain with the book, the chart or the object, and builds on what the student says.
     e.g. Teacher: "Ali, take the paper and show us one quarter." Student: "I cut it in four parts and coloured one." Teacher: "One part of four, yes. Now show us two quarters."
```

### D1 Children's reasoning
*Was: Depth of Student Reasoning*  
**Definition:** How deep children's answers are: one word, a longer answer that only repeats what was said, or an answer that shows reasoning in the child's own words (says why, compares, uses a rule on a new case, explains a choice, gives their own example).  
**Couldn't tell:** student lines are missing or garbled for a large part of the lesson, so their answers cannot be read.  

**Proposed**
```
1  Students give only one-word answers or repeat a fact.
     e.g. Student: "Twelve."
2  At least one answer, from any student, is longer than a phrase, but it only repeats what was already said or read, or finishes the teacher's sentence.
     e.g. Teacher: "Because they were very small, they thought that..." Student: "...my going to the earth is useless."
3  At least two answers, from any students, show reasoning in the child's own words: they say why, compare two things, use a rule on a new case, or explain a choice. Finishing the teacher's sentence, or repeating a reason the teacher already gave, does not count.
     e.g. Teacher: "Why 210, why not 150?" Student: "Because we subtracted 150 from the complete angle."
4  Beyond level 3, a student gives their own example, or links the idea to something else, that the teacher did not say first.
     e.g. Teacher: "How does a dream get shattered?" Student: "If I had a project and it broke, my dream was shattered." / Teacher: "What is urbanisation?" Student: "The school being built now, it affected the ecosystem."
```

### D2 How many children spoke
*Was: Participation Breadth*  
**Definition:** How many different children speak across the lesson, and whether children silent early on speak later.  
**Combined indicator.** The DC reports the number of student turns, split into the first and second half of the lesson. It does not give a level, because every level counts different children.  
**Coach adds:** how many different children spoke, and how many children who were quiet in the first half spoke in the second. The coach sets the final level with a written justification.  
**Couldn't tell (DC):** student lines are missing or garbled for a large part of the lesson.  

**Levels (for the coach)**
```
1  No student speaks during the lesson.
2  Only the same one or two children speak.
     e.g. (coach) "Only Ali and Sara answered all lesson; 30 student turns, almost all theirs."
3  Three to five different children speak.
     e.g. (coach) "4 different children answered, all from the front rows."
4  Six or more different children speak, and at least two children who had not spoken in the first half speak in the second half.
     e.g. (coach) "9 different children spoke, including 2 from the back row who were quiet until the group activity."
```

### D3 Children answering each other
*Was: Student-to-Student Interaction*  
**Definition:** Whether children talk to each other about the task, not only to the teacher: one child answers, agrees with or adds to what another said. At its strongest they give reasons to agree or disagree and reach one shared answer.  
**Combined indicator.** The DC reports the exchanges it finds (a child agreeing with or adding to another, a second child named to agree) and the level the transcript alone supports.  
**Coach adds:** children talking to each other about the task that the recording did not pick up, mostly during pair and group work, and whether they gave reasons or reached a shared answer. The coach sets the final level with a written justification.  
**Couldn't tell (DC):** student lines are missing or garbled for a large part of the lesson. This is separate from the N/A line below, which is for lessons where no child-to-child talk is found.  

**Proposed**
```
1  No student speaks to another student about the task.
     e.g. Student: "Is the answer twelve, miss?" Teacher: "Yes, it is twelve." (the teacher answered, so the student was talking to the teacher)
2  One time, a student answers and the teacher names a second child who agrees with the previous student's answer, or the student says I agree with her/him referring to the previously given answer by the student.
     e.g. Teacher: "Ali, what is your answer?" Student: "Twelve." Teacher: "Hina, do you agree?" Student: "Yes, it is twelve." (the teacher names a second child, who agrees) / Student: "It is twelve." Student: "I agree with him." (a child agrees with the answer just given)
3  At least two times, a student answers, agrees with, or adds to what another student just said.
     e.g. Teacher: "Sara, what is nine plus six?" Student: "Fifteen." Teacher: "Omar, do you agree?" Student: "Yes, it is fifteen." ... later: Student: "It is a verb." Student: "I agree with her."
4  Beyond level 3, students give a reason to agree or disagree with each other, and reach one shared answer.
     e.g. Student: "It is a noun because we can see it." Student: "No, it is a verb because it shows an action." Student: "Okay, so it is a verb, we agree."
N/A  Do not score this indicator if there are no two Student lines in a row where students talk about the topic, and the teacher never names a second child to agree with a student's answer. It is then left out of the feedback.
```

### D4 Trying when unsure
*Was: Student Confidence & Risk-Taking*  
**Definition:** Whether children dare to answer when they are not sure: they stay silent, answer only when sure, answer while unsure, or answer unasked and try again after a wrong answer. Only the trying counts, not whether the answer is right.  
**N/A link:** D4 is N/A when C1 is scored 1.  
**Combined indicator.** The DC reports unsure answers ("Maybe...", "Should I say...?", an answer that changes halfway), second tries after a wrong answer, and answers given without being asked, with the level the transcript alone supports. Its cues are English only for now and rarely appear in the Urdu transcripts.  
**Coach adds:** how children behave when they are unsure: whether they have a go or go quiet, put a hand up or wait for the teacher, and try again after a wrong answer. The coach sets the final level with a written justification.  
**Couldn't tell (DC):** student lines are missing or garbled for a large part of the lesson.  

**Proposed**
```
1  When the teacher asks, students stay silent, say "I do not know", or wait for the teacher to give the answer.
2  Students answer only when they are sure. Nobody gives a half-sure answer; when unsure they say nothing.
3  At least two times, a student answers while clearly unsure, for example "Maybe...", "Should I say...?", or an answer that changes halfway.
     e.g. Teacher: "What is seven plus five?" Student: "Maybe it is... twelve." ... later: Teacher: "Which word is the verb?" Student: "Should I say... the second one?" ... later: Teacher: "What is nine plus six?" Student: "Fourteen... no, wait, fifteen." (three times, one of each cue)
4  Beyond level 3, a student answers without being asked, or tries again after a wrong answer instead of giving up.
     e.g. Student: "Miss, I want to try." / (after "No") Student: "Wait, then it is fourteen."
```

### D5 Children's own questions
*Was: Student Questioning & Curiosity*  
**Definition:** Whether children ask questions of their own: only about the task (which page, may I answer), or about the idea itself (how or why something works, a different case). Repeating the teacher's question or giving an unsure answer does not count.  
**Couldn't tell:** student lines are missing or garbled for a large part of the lesson.  

**Proposed**
```
1  No student asks the teacher a question of their own. An unsure answer ("Is it twelve?") or a student repeating the teacher's question ("Why?") does not count.
2  Students ask only questions about the task: which page, do we write this, is it homework, may I answer, or please say it again.
     e.g. Student: "Which page, miss?" / "May I answer?" / "Sorry, what?"
3  Students ask at least one question about the idea itself: how or why something works, or what would happen in a different case.
     e.g. Student: "Why does the answer get bigger?" / "What if we use five instead of three?"
4  Beyond level 3, students ask at least two questions about the idea, and one of them is about something the teacher has not talked about in this lesson.
     e.g. (lesson on adding) Student: "Can we add numbers bigger than a million?"
```

### F1 Accuracy of content
*Was: Content Accuracy*  
**Definition:** Whether what the teacher says about the subject is correct, and whether a wrong statement is corrected. Count something as wrong only when you are sure.  
**Couldn't tell:** the teacher's speech is missing or garbled for a large part of the lesson, or the only possible errors may be transcription mistakes (a mis-heard number or term).  

**Proposed**
```
1  The teacher says something wrong and leaves it, so students are left with wrong information. Count something as wrong only if you are sure; a word that may be a transcription or translation mistake does not count.
     e.g. Teacher: "A spider is an insect. It has six legs." (a spider has eight legs)
2  Mostly correct, but the teacher makes a small slip (a wrong rule or a wrong word) and does not correct it.
     e.g. Teacher: "The bottom number is the numerator." (it is the denominator; nobody corrects it)
3  Everything the teacher says is correct. When not sure, the teacher says so and does not guess.
     e.g. Teacher: "I am not sure about that date. Let us check the book."
4  Beyond level 3, the teacher warns students about a common mistake before they make it.
     e.g. Teacher: "Careful: many children add the bottom numbers too. We keep the bottom number the same."
```

### F2 Subject words
*Was: Use of Academic Language*  
**Definition:** Whether the teacher uses the subject's own words (such as "numerator" or "verb") and explains them, and whether children are made to use them.  
**Couldn't tell:** the teacher's speech is missing or garbled for a large part of the lesson.  

**Proposed**
```
1  The teacher uses everyday words only, and no subject words.
     e.g. Teacher: "Take away three." (never "subtract")
2  The teacher uses some subject words but does not explain them, or mixes them up.
     e.g. Teacher: "Find the sum." ... "Now the total." ... "Now the answer." (the same thing, three words, none explained)
3  At least two times, the teacher uses a subject word and explains what it means.
     e.g. Teacher: "The numerator is the top number. It tells us how many parts we have."
4  Beyond level 3, the teacher makes students use the subject words, and corrects loose words by giving the right one.
     e.g. Student: "The bottom number." Teacher: "We say denominator. Say it."
```

### F3 Explaining why
*Was: Depth of Explanation*  
**Definition:** Whether the teacher explains why a rule or step works, with a reason, an example or a picture, or only says how to do it. At its strongest, the teacher turns a child's question into a short lesson or asks the children to give the reason.  
**Couldn't tell:** the teacher's speech is missing or garbled for a large part of the lesson.  

**Proposed**
```
1  The teacher only says how to do it, and gives no reason.
     e.g. Teacher: "First add, then divide. Do it this way."
2  The teacher gives a reason now and then, but mostly asks students to remember the rule.
     e.g. Teacher: "Just remember: a noun is a naming word."
3  At least two times, the teacher explains why a rule or step works, with a reason, an example, or a picture.
     e.g. Teacher: "We keep the bottom number the same because the parts are the same size. Look at the picture."
4  Beyond level 3, the teacher turns a student's question into a short lesson that goes further, or asks the children to give the reason.
     e.g. Student: "Why is it a verb?" Teacher: "Good question. Let us test it together..." / Teacher: "We keep the bottom number the same. Why? Who can tell us the reason?" Student: "Because the parts are the same size."
```

### F4 Links to real life
*Was: Relevance & Connections*  
**Definition:** Whether the teacher links the lesson to real life, another subject or an earlier lesson, with an example or comparison, and explains the link. At its strongest, children build on the teacher's link.  
**Couldn't tell:** the teacher's speech is missing or garbled for a large part of the lesson.  

**Proposed**
```
1  The teacher gives no real-life example, comparison, or link to another subject or an earlier lesson.
2  The teacher mentions a link and moves on without explaining it.
     e.g. Teacher: "This is like shopping. Now back to the page."
3  The teacher gives a link and explains how it fits the idea.
     e.g. Teacher: "If you buy three pens at five rupees each, you pay three fives. That is multiplication."
4  Beyond level 3, a student builds on the teacher's link: they add to it, ask about it, or explain it in their own words.
     e.g. Teacher: "Three pens at five rupees each: you pay three fives." Student: "And if I buy four pens, I pay four fives, so twenty."
```

