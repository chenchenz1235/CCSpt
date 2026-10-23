function r=em_compare_script(left,right,reportFolder)
% Official text comparison evidence; bounded local MATLAB classification is
% conservative and never evaluates the script being compared.
r=struct('status','compared','source','MATLAB official visdiff + conservative script text classification','changes',{{}},'classification','different','classificationNote','','incomplete',false);
em_assert_readable(left);em_assert_readable(right);
if ~isfolder(reportFolder),mkdir(reportFolder);end
comparison=visdiff(left,right,'text');
r.report=char(publish(comparison,OutputFolder=reportFolder));
a=fileread(left);b=fileread(right);
if strcmp(a,b),r.classification='same';r.classificationNote='MATLAB 读取文本完全一致';
elseif strcmp(stripDisplayComments(a),stripDisplayComments(b)),r.classification='minor';r.classificationNote='仅完整普通注释行、空行或行首尾格式差异；指令注释保留';
else,r.classification='different';r.classificationNote='脚本文本存在实际/待核实差异';end
end
function result=stripDisplayComments(text)
text=strrep(strrep(text,sprintf('\r\n'),sprintf('\n')),sprintf('\r'),sprintf('\n'));
lines=split(string(text),newline);kept=strings(0);
for k=1:numel(lines)
    line=strtrim(lines(k));
    % Block comment delimiters, codegen/checker directives and section markers
    % remain visible. Conservative: only ordinary standalone comments removed.
    if strlength(line)==0,continue;end
    if startsWith(line,'%') && isempty(regexp(char(line),'^%\s*[#@$%{}]','once')),continue;end
    kept(end+1)=line;
end
result=join(kept,newline);
end
