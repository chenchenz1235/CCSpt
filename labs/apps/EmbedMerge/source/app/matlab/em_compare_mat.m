function r=em_compare_mat(left,right)
% Custom bounded field traversal, distinct from official model comparison.
r=struct('status','compared','source','MATLAB custom MAT/Bus traversal','changes',{{}},'limits',struct('depth',20,'elements',10000),'incomplete',false);
em_assert_readable(left);em_assert_readable(right);
a=whos('-file',left);b=whos('-file',right);names=union({a.name},{b.name});
for k=1:numel(names)
    key=names{k};ia=find(strcmp({a.name},key),1);ib=find(strcmp({b.name},key),1);
    if isempty(ia)||isempty(ib),r.changes{end+1}=row(key,'VariablePresence',~isempty(ia),~isempty(ib));continue;end
    if a(ia).bytes>16*1024*1024 || b(ib).bytes>16*1024*1024,r.changes{end+1}=row(key,'UnverifiedSizeLimit',a(ia).bytes,b(ib).bytes);r.incomplete=true;continue;end
    supported={'double','single','logical','char','string','struct','cell','int8','uint8','int16','uint16','int32','uint32','int64','uint64','Simulink.Bus','Simulink.BusElement'};
    if ~ismember(a(ia).class,supported)||~ismember(b(ib).class,supported),r.changes{end+1}=row(key,'UnverifiedClass',a(ia).class,b(ib).class);r.incomplete=true;continue;end
    va=load(left,key);vb=load(right,key);[rows,incomplete]=walk(va.(key),vb.(key),key,0);r.changes=[r.changes rows];r.incomplete=r.incomplete||incomplete;
end
end
function [out,incomplete]=walk(a,b,p,depth)
out={};incomplete=false;
if depth>20||numel(a)>10000||numel(b)>10000,out={row(p,'UnverifiedTraversalLimit',size(a),size(b))};incomplete=true;return;end
if ~strcmp(class(a),class(b)),out={row(p,'DataType',class(a),class(b))};return;end
if ~isequal(size(a),size(b)),out={row(p,'Dimensions',size(a),size(b))};return;end
if isa(a,'Simulink.Bus')||isa(a,'Simulink.BusElement')
    if ~isscalar(a),for i=1:numel(a),[rows,inc]=walk(a(i),b(i),sprintf('%s(%d)',p,i),depth+1);out=[out rows];incomplete=incomplete||inc;end;return;end
    keys=properties(a);
    if isa(a,'Simulink.Bus')
        if ~isequal({a.Elements.Name},{b.Elements.Name}),out{end+1}=row(p,'ElementOrder',{a.Elements.Name},{b.Elements.Name});end
    end
    for k=1:numel(keys)
        key=keys{k};
        if isa(a,'Simulink.Bus') && strcmp(key,'Elements')
            [rows,inc]=elements(a.Elements,b.Elements,[p '.Elements'],depth+1);
        else
            [rows,inc]=walk(a.(key),b.(key),[p '.' key],depth+1);
        end
        out=[out rows];incomplete=incomplete||inc;
    end
elseif isstruct(a)
    keys=union(fieldnames(a),fieldnames(b),'stable');
    if ~isequal(fieldnames(a),fieldnames(b)),out{end+1}=row(p,'FieldOrder',fieldnames(a),fieldnames(b));end
    for i=1:numel(a),for k=1:numel(keys),key=keys{k};pp=sprintf('%s(%d).%s',p,i,key);if ~isfield(a,key)||~isfield(b,key),out{end+1}=row(pp,'FieldPresence',isfield(a,key),isfield(b,key));else,[rows,inc]=walk(a(i).(key),b(i).(key),pp,depth+1);out=[out rows];incomplete=incomplete||inc;end;end;end
elseif iscell(a)
    for i=1:numel(a),[rows,inc]=walk(a{i},b{i},sprintf('%s{%d}',p,i),depth+1);out=[out rows];incomplete=incomplete||inc;end
elseif isnumeric(a)||islogical(a)||ischar(a)||isstring(a)
    if ~isequaln(a,b),out={row(p,'Value',preview(a),preview(b))};end
else,out={row(p,'UnverifiedClass',class(a),class(b))};incomplete=true;
end
end
function [out,incomplete]=elements(a,b,p,depth)
out={};incomplete=false;left={a.Name};right={b.Name};
if numel(a)>10000||numel(b)>10000,out={row(p,'UnverifiedTraversalLimit',size(a),size(b))};incomplete=true;return;end
if isscalar(a)&&isscalar(b)&&strcmp(a.Name,b.Name),[out,incomplete]=walk(a,b,p,depth);return;end
names=union(left,right,'stable');names=names(:)';
for k=1:numel(names)
    name=names{k};ia=find(strcmp(left,name),1);ib=find(strcmp(right,name),1);pp=[p '(' name ')'];
    if isempty(ia)||isempty(ib)
        if isempty(ia),va=[];else,va=struct('index',ia,'name',a(ia).Name,'dataType',a(ia).DataType,'dimensions',a(ia).Dimensions);end
        if isempty(ib),vb=[];else,vb=struct('index',ib,'name',b(ib).Name,'dataType',b(ib).DataType,'dimensions',b(ib).Dimensions);end
        out{end+1}=row(pp,'ElementPresence',va,vb);
    else
        [rows,inc]=walk(a(ia),b(ib),pp,depth);out=[out rows];incomplete=incomplete||inc;
    end
end
end
function r=row(p,property,a,b)
r=struct('path',p,'property',property);r.left=a;r.right=b;
end
function v=preview(a)
v=struct('class',class(a),'size',size(a),'value',a(1:min(30,numel(a))),'truncated',numel(a)>30);
end
