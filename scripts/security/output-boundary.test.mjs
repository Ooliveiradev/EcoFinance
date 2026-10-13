import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
test('web and native source cannot introduce raw HTML output sinks', async()=> {
  const lint=new ESLint();
  for(const filePath of ['apps/next/src/components/future.tsx','apps/expo/src/screens/future.tsx']) {
    const [result]=await lint.lintText('export const Output = ({ text }) => <div dangerouslySetInnerHTML={{ __html: text }} />;',{filePath});
    assert.ok(result.messages.some(message=>message.ruleId==='no-restricted-syntax'));
  }
  const [dom]=await lint.lintText('document.body.innerHTML = location.hash; document.write(location.hash);',{filePath:'apps/next/src/lib/future-output.ts'});
  assert.equal(dom.messages.filter(message=>message.ruleId==='no-restricted-properties').length,2);
});
test('the raw theme bootstrap remains a static module constant without interpolated input',()=> {
  const source=ts.createSourceFile('layout.tsx',readFileSync('apps/next/src/app/layout.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=source.statements.filter(ts.isVariableStatement).flatMap(statement=>statement.declarationList.declarations);
  const script=declarations.find(declaration=>ts.isIdentifier(declaration.name) && declaration.name.text==='themeInitScript');
  assert.ok(script?.initializer && (ts.isNoSubstitutionTemplateLiteral(script.initializer) || ts.isStringLiteral(script.initializer)));
  const sinks=[];
  const visit=node=> {
    if(ts.isJsxAttribute(node) && node.name.getText(source)==='dangerouslySetInnerHTML')sinks.push(node);
    ts.forEachChild(node,visit);
  };
  visit(source);
  assert.equal(sinks.length,1);
  const sink=sinks[0], element=sink.parent.parent;
  assert.equal(element.tagName.getText(source),'script');
  assert.ok(sink.initializer && ts.isJsxExpression(sink.initializer));
  const value=sink.initializer.expression;
  assert.ok(value && ts.isObjectLiteralExpression(value) && value.properties.length===1);
  const property=value.properties[0];
  assert.ok(ts.isPropertyAssignment(property) && property.name.getText(source)==='__html' && ts.isIdentifier(property.initializer) && property.initializer.text==='themeInitScript');
});
